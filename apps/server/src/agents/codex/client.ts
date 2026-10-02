import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveCodexCommand } from './launch';
import {
  cancelled,
  CodexError,
  record,
  type CodexRuntimeOptions,
  type RecordValue,
  type RpcId,
  type ServerRequest,
} from './types';

export const MAX_RPC_LINE_BYTES = 8 * 1024 * 1024;
export const MAX_PENDING_REQUESTS = 128;
export const RPC_TIMEOUT_MS = 30_000;
type Pending = { resolve(value: RecordValue): void; reject(error: Error): void; timer: NodeJS.Timeout };
type ClientOptions = CodexRuntimeOptions & { cwd?: string; timeoutMs?: number };

/** app-server 的 stdio 仅接受逐行 JSON-RPC；stderr 持续排空而不泄露诊断原文。 */
export class CodexClient {
  readonly closed: Promise<void>;
  onNotification: (method: string, params: RecordValue) => void = () => {};
  onRequest: (request: ServerRequest) => void = (request) => this.rejectRequest(request.id);
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<RpcId, Pending>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private failure?: Error;
  private stopping = false;
  private closing?: Promise<void>;
  private resolveClosed!: () => void;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  private readonly onAbort = () => this.terminate(cancelled());

  private constructor(command: string, args: string[], options: ClientOptions) {
    this.timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS;
    this.signal = options.signal;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.child = spawn(command, [...args, 'app-server', '--listen', 'stdio://'], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'pipe',
      windowsHide: true,
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.terminate(new CodexError('Codex 通信管道已关闭。')));
    this.child.on('error', () => this.terminate(new CodexError('无法启动 Codex，请检查安装与可执行文件路径。')));
    this.child.on('close', () => {
      this.fail(this.failure ?? new CodexError('Codex 进程意外退出。'));
      this.signal?.removeEventListener('abort', this.onAbort);
      this.resolveClosed();
    });
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (options.signal?.aborted) this.onAbort();
  }

  static async start(options: ClientOptions = {}): Promise<CodexClient> {
    if (options.signal?.aborted) throw cancelled();
    const launch = await resolveCodexCommand(options);
    if (options.signal?.aborted) throw cancelled();
    return new CodexClient(launch.command, launch.args, options);
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'ssh-server', title: 'SSH Server', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.notify('initialized', {});
  }

  request(method: string, params: RecordValue): Promise<RecordValue> {
    if (this.failure || this.stopping) return Promise.reject(this.failure ?? cancelled());
    if (this.pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new CodexError('Codex 待处理请求过多。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexError('Codex 请求超时，请检查本机运行时状态。'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: RecordValue): void {
    this.write({ method, params });
  }
  respond(id: RpcId, result: RecordValue): void {
    this.write({ id, result });
  }
  rejectRequest(id: RpcId): void {
    this.write({ id, error: { code: -32601, message: '客户端暂不支持此请求' } });
  }

  private write(message: RecordValue): void {
    if (this.failure || this.stopping) return;
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_RPC_LINE_BYTES) {
      this.terminate(new CodexError('Codex 请求超过单条消息大小上限。'));
      return;
    }
    this.child.stdin.write(line);
  }

  private receive(chunk: Buffer): void {
    if (this.failure) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline = this.buffer.indexOf(10);
    while (newline >= 0) {
      if (newline > MAX_RPC_LINE_BYTES) {
        this.oversize();
        return;
      }
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (line.length > 0) this.parse(line);
      if (this.failure) return;
      newline = this.buffer.indexOf(10);
    }
    if (this.buffer.length > MAX_RPC_LINE_BYTES) this.oversize();
  }

  private oversize(): void {
    this.terminate(new CodexError('Codex 返回内容超过 8 MiB，无法完整读取。'));
  }
  private parse(line: Buffer): void {
    try {
      const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('协议格式');
      this.dispatch(record(decoded));
    } catch {
      this.terminate(new CodexError('Codex 返回了无效的通信消息。'));
    }
  }

  private dispatch(message: RecordValue): void {
    const id = message.id;
    const hasId = typeof id === 'number' || typeof id === 'string';
    if (typeof message.method === 'string') {
      const params = record(message.params);
      if (hasId) this.onRequest({ id, method: message.method, params });
      else this.onNotification(message.method, params);
      return;
    }
    if (hasId) this.resolveResponse(id, message);
  }

  private resolveResponse(id: RpcId, message: RecordValue): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new CodexError('Codex 请求失败，请检查本机配置、登录状态或会话是否仍存在。'));
    else pending.resolve(record(message.result));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  terminate(error: Error = cancelled()): void {
    this.fail(error);
    this.child.kill('SIGKILL');
  }

  close(): Promise<void> {
    this.closing ??= this.closeProcess();
    return this.closing;
  }

  private async closeProcess(): Promise<void> {
    this.stopping = true;
    this.fail(cancelled());
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1_000);
    await this.closed;
    clearTimeout(timer);
  }
}
