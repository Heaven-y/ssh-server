import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveLocalCommand, type ResolvedCommand } from '../../process/executable';
import { AntigravityLines } from './lines';
import {
  managementFailure,
  managementObject,
  managementRequest,
  type ManagementBackend,
  type ManagementRecord,
} from './management-rpc';

type Pending = { resolve(value: ManagementRecord): void; reject(error: Error): void; timer: NodeJS.Timeout };
export type ManagementProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  geminiDir: string;
  signal?: AbortSignal;
  /** 仅测试可注入合成进程；生产始终解析本机 agy。 */
  command?: ResolvedCommand;
};

class ManagementProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private readonly closed: Promise<void>;
  private exited = false;
  private failed = false;
  private sequence = 0;
  private bytes = 0;
  private closeTask?: Promise<void>;
  constructor(command: ResolvedCommand, options: ManagementProcessOptions, log: string) {
    this.child = spawn(
      command.command,
      [
        ...command.args,
        'acp',
        '--gemini-dir',
        options.geminiDir,
        '--app-data-dir',
        'antigravity-cli',
        '--disable-telemetry',
        '--log-file',
        log,
      ],
      { cwd: options.cwd, env: options.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const lines = new AntigravityLines((line) => this.receive(line), 2 * 1024 * 1024);
    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.count(chunk.length);
        lines.push(chunk);
      } catch {
        this.fail();
      }
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      try {
        this.count(chunk.length);
      } catch {
        this.fail();
      }
    });
    this.child.stdin.on('error', () => this.fail());
    this.child.once('error', () => this.fail());
    this.closed = new Promise((resolve) =>
      this.child.once('close', () => {
        this.exited = true;
        this.fail();
        resolve();
      }),
    );
  }
  get pid() {
    return this.child.pid;
  }
  get alive() {
    return !this.exited && !this.failed;
  }
  private count(bytes: number) {
    this.bytes += bytes;
    if (this.bytes > 4 * 1024 * 1024) throw managementFailure();
  }
  private fail() {
    this.failed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(managementFailure());
    }
    this.pending.clear();
  }
  private receive(line: string) {
    const value = managementObject(JSON.parse(line));
    if (typeof value.id !== 'number') return;
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    clearTimeout(pending.timer);
    // session/list 只用于引导本地后端；无登录时仍可管理本机持久记录。
    if (value.error && managementObject(value.error).code !== -32000) pending.reject(managementFailure());
    else pending.resolve(managementObject(value.result));
  }
  request(method: 'initialize' | 'session/list', params: ManagementRecord): Promise<ManagementRecord> {
    if (!this.alive) return Promise.reject(managementFailure());
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(managementFailure());
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  private async waitClosed(ms: number) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
    clearTimeout(timer);
  }
  close(): Promise<void> {
    this.fail();
    this.closeTask ??= this.stop();
    return this.closeTask;
  }
  private async stop() {
    if (this.exited) return;
    this.child.stdin.end();
    await this.waitClosed(2000);
    if (this.exited) return;
    if (process.platform === 'win32' && this.child.pid) await this.killTree();
    else this.child.kill('SIGKILL');
    await this.waitClosed(2000);
    if (!this.exited) throw managementFailure();
  }
  private killTree(): Promise<void> {
    return new Promise((resolve) => {
      const killer = spawn(
        path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(this.child.pid), '/T', '/F'],
        { windowsHide: true, shell: false, stdio: 'ignore' },
      );
      const timer = setTimeout(() => {
        killer.kill();
        this.child.kill('SIGKILL');
        resolve();
      }, 2000);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      killer.once('close', finish);
      killer.once('error', () => {
        this.child.kill('SIGKILL');
        finish();
      });
    });
  }
}

function portFromLog(log: string, owner: number | undefined): number | undefined {
  const pid = Number(/Starting language server process with pid (\d+)/.exec(log)?.[1]);
  const port = Number(/Language server listening on random port at (\d+) for HTTP\r?\n/.exec(log)?.[1]);
  return pid === owner && port > 0 && port <= 65535 ? port : undefined;
}
function fileMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

/** 日志路径是本次 mkdtemp 创建的；必须同时匹配自己的后端 PID 和 HTTP 端口。 */
async function ownPort(file: string, process: ManagementProcess): Promise<number> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && process.alive) {
    try {
      if ((await stat(file)).size > 512 * 1024) throw managementFailure();
      const log = await readFile(file, 'utf8');
      const port = portFromLog(log, process.pid);
      if (port) return port;
    } catch (error) {
      if (!fileMissing(error)) throw managementFailure();
    }
    await delay(30);
  }
  throw managementFailure();
}

export async function startManagementBackend(options: ManagementProcessOptions): Promise<ManagementBackend> {
  if (options.signal?.aborted) throw managementFailure();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-agy-management-'));
  const log = path.join(temporary, 'runtime.log');
  let process: ManagementProcess | undefined;
  const requests = new AbortController();
  const abort = () => {
    requests.abort();
    void process?.close().catch(() => undefined);
  };
  const close = async () => {
    requests.abort();
    options.signal?.removeEventListener('abort', abort);
    await process?.close();
    await rm(temporary, { recursive: true, force: true });
  };
  try {
    if (options.signal?.aborted) throw managementFailure();
    process = new ManagementProcess(options.command ?? resolveLocalCommand('agy', options.env), options, log);
    options.signal?.addEventListener('abort', abort, { once: true });
    const init = await process.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'agentdeck-session-manager', version: '1' },
      clientCapabilities: {},
    });
    if (managementObject(init.agentInfo).name !== 'Antigravity ACP Server') throw managementFailure();
    await process.request('session/list', { cwd: options.cwd });
    const port = await ownPort(log, process);
    return {
      request: (method, params) =>
        process?.alive ? managementRequest(port, method, params, requests.signal) : Promise.reject(managementFailure()),
      close,
    };
  } catch {
    await close();
    throw managementFailure();
  }
}
