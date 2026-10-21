// 长驻 Codex 会话：一个 app-server 进程承载同一原生线程的多轮对话，空闲后回收。
import type { AgentEvent } from '@ssh-server/shared';
import type { AgentTurnInput, TurnEnv } from '../types';
import { sameSessionDirectory } from '../session-scope';
import { CodexClient } from './client';
import { validateCodexSkill } from './capabilities';
import { threadParams } from './config';
import { CodexEventMapper, turnEnd } from './mapper';
import { CodexPermissions } from './permissions';
import { checkedThread } from './sessions';
import {
  cancelled,
  CodexError,
  record,
  safeError,
  text,
  type CodexRuntimeOptions,
  type RecordValue,
  type ServerRequest,
} from './types';

const INTERRUPT_FALLBACK_MS = 5_000;
const TURN_START_TIMEOUT_MS = 30_000;

export class CodexRuntime {
  private readonly env: TurnEnv;
  private client?: CodexClient;
  private nativeConfig?: RecordValue;
  private thread?: string;
  private model?: string;
  private connecting?: Promise<CodexClient>;
  private closing?: Promise<void>;
  private broken = false;
  current?: CodexTurn;

  constructor(
    input: AgentTurnInput,
    private readonly options: CodexRuntimeOptions = {},
  ) {
    // 令牌随会话存活：MCP 子进程在进程启动时拿到它，换令牌会让后续轮次失效。
    this.env = input.acquireEnv();
  }

  get alive(): boolean {
    return !this.broken && this.closing === undefined;
  }

  get sessionId(): string | undefined {
    return this.thread || undefined;
  }

  get sessionModel(): string | undefined {
    return this.model;
  }

  /** 首次使用时启动进程并读取原生配置；后续轮次直接复用。 */
  async ensure(input: AgentTurnInput, signal: AbortSignal): Promise<{ client: CodexClient; threadId: string }> {
    const client = await this.connect(input, signal);
    if (!this.thread) await this.openThread(client, input, signal);
    return { client, threadId: this.thread! };
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    this.current?.cancel();
    await this.client?.close().catch(() => undefined);
    this.env.release();
  }

  private connect(input: AgentTurnInput, signal: AbortSignal): Promise<CodexClient> {
    this.connecting ??= this.start(input, signal);
    return this.connecting;
  }

  private async start(input: AgentTurnInput, signal: AbortSignal): Promise<CodexClient> {
    const client = await CodexClient.start({
      ...this.options,
      env: { ...this.options.env, ...this.env.env },
      cwd: input.workspace.localDir,
      signal,
    });
    this.client = client;
    client.onRequest = (request: ServerRequest) => this.route(client, request);
    client.onNotification = (method: string, params: RecordValue) => this.current?.notification(method, params);
    try {
      await client.initialize();
      this.nativeConfig = await client.request('config/read', {
        cwd: input.workspace.localDir,
        includeLayers: false,
      });
    } catch (error) {
      await client.close().catch(() => undefined);
      this.connecting = undefined;
      throw error;
    }
    void client.closed.then(() => {
      this.broken = true;
      this.current?.fail('Codex 进程已退出，请重新发送');
    });
    return client;
  }

  /** 未指定会话时新建原生线程，已指定时续接并复核目录归属。 */
  private async openThread(client: CodexClient, input: AgentTurnInput, signal: AbortSignal): Promise<void> {
    const id = input.sessionId;
    const params = threadParams(input, this.nativeConfig ?? {}, Object.keys(this.env.env));
    if (id) await checkedThread(client, id, input.workspace.localDir);
    if (signal.aborted) throw cancelled();
    const response = await client.request(id ? 'thread/resume' : 'thread/start', {
      ...params,
      ...(id ? { threadId: id, excludeTurns: true } : {}),
    });
    const thread = record(response.thread);
    await this.verifyThread(thread, id, input.workspace.localDir);
    this.thread = text(thread.id);
    this.model = text(response.model) || text(thread.model);
  }

  /** 复核原生线程身份：必须带 ID、属于当前工作区，且与续接目标一致。 */
  private async verifyThread(thread: RecordValue, id: string | undefined, localDir: string): Promise<void> {
    if (!text(thread.id) || !(await sameSessionDirectory(text(thread.cwd), localDir))) {
      throw new CodexError('Codex 返回了不属于当前工作区的会话。');
    }
    if (id && thread.id !== id) throw new CodexError('Codex 返回的会话标识与续接目标不一致。');
  }

  private route(client: CodexClient, request: ServerRequest): void {
    const turn = this.current;
    if (!turn || turn.foreignRequest(request.params)) client.rejectRequest(request.id);
    else turn.onRequest(request);
  }
}

export class CodexTurn {
  private readonly mapper: CodexEventMapper;
  private readonly manualCompaction: boolean;
  private readonly preparation = new AbortController();
  private permissions?: CodexPermissions;
  private client?: CodexClient;
  private phase: 'preparing' | 'starting' | 'running' | 'done' = 'preparing';
  private stopped = false;
  private turnId = '';
  private interruptSent = false;
  private interruptTimer?: NodeJS.Timeout;
  private readonly earlyNotifications: Array<{ method: string; params: RecordValue }> = [];
  readonly done: Promise<void>;
  private complete!: () => void;
  private readonly started: Promise<void>;
  private start!: () => void;
  private readonly onAbort = () => void this.interrupt();

  constructor(
    private readonly runtime: CodexRuntime,
    private readonly input: AgentTurnInput,
    signal: AbortSignal,
  ) {
    this.manualCompaction = input.invocation?.kind === 'command' && input.invocation.name === 'compact';
    this.mapper = new CodexEventMapper({ manualCompaction: this.manualCompaction });
    this.done = new Promise<void>((resolve) => {
      this.complete = resolve;
    });
    this.started = new Promise<void>((resolve) => {
      this.start = resolve;
    });
    signal.addEventListener('abort', this.onAbort, { once: true });
    if (signal.aborted) this.stopped = true;
  }

  get foreignThreadId(): string {
    return this.runtime.sessionId ?? '';
  }

  async run(): Promise<void> {
    let end: AgentEvent = { type: 'turn_end', isError: false };
    try {
      this.ensureActive();
      this.validateInput();
      const { client, threadId } = await this.runtime.ensure(this.input, this.preparation.signal);
      this.client = client;
      this.permissions = new CodexPermissions(client, this.input, this.mapper);
      this.input.emit({
        type: 'session',
        sessionId: threadId,
        model: this.runtime.sessionModel ?? '',
        cwd: this.input.workspace.localDir,
        agent: 'codex',
      });
      this.ensureActive();
      end = await this.startTurn(client, threadId);
    } catch (error) {
      if (!this.stopped) {
        end = { type: 'turn_end', isError: true };
        this.input.emit({ type: 'error', message: safeError(error) });
      }
    } finally {
      this.phase = 'done';
      clearTimeout(this.interruptTimer);
      this.permissions?.cancel();
      for (const event of this.mapper.finishCompaction(this.stopped ? 'interrupted' : 'failed')) this.input.emit(event);
      this.input.emit(end);
      if (this.runtime.current === this) this.runtime.current = undefined;
      this.complete();
    }
  }

  /** 其他线程或轮次的审批请求不属于本会话，直接拒绝。 */
  foreignRequest(params: RecordValue): boolean {
    return (
      (!!this.runtime.sessionId && params.threadId !== this.runtime.sessionId) ||
      (!!this.turnId && params.turnId !== this.turnId)
    );
  }

  onRequest(request: ServerRequest): void {
    this.permissions?.request(request);
  }

  cancel(): void {
    this.stopped = true;
    this.permissions?.cancel();
    this.preparation.abort();
  }

  fail(message: string): void {
    if (this.phase === 'done') return;
    this.input.emit({ type: 'error', message });
  }

  notification(method: string, params: RecordValue): void {
    const threadId = this.runtime.sessionId;
    if (!threadId || params.threadId !== threadId || this.phase === 'done') return;
    if (this.threadNotification(method, params) || this.phase === 'preparing') return;
    if (method === 'turn/started') {
      this.identifyTurn(text(record(params.turn).id));
      return;
    }
    if (!this.turnId) {
      if (this.earlyNotifications.length >= 128) {
        this.client?.terminate(new CodexError('Codex 轮次开始前的通知过多。'));
      } else {
        this.earlyNotifications.push({ method, params });
      }
      return;
    }
    this.currentNotification(method, params);
  }

  interrupt(): Promise<void> {
    if (this.phase === 'done' || this.stopped) return Promise.resolve();
    this.stopped = true;
    this.permissions?.cancel();
    if (this.phase === 'preparing') {
      this.preparation.abort();
      return Promise.resolve();
    }
    this.interruptTimer = setTimeout(() => this.client?.terminate(), INTERRUPT_FALLBACK_MS);
    this.sendInterrupt();
    return Promise.resolve();
  }

  private ensureActive(): void {
    if (this.stopped) throw cancelled();
  }

  private validateInput(): void {
    if (this.input.invocation?.kind !== 'command') return;
    if (this.input.invocation.name === 'context')
      throw new CodexError('当前 Codex app-server 没有独立上下文查询接口，请在本机 CLI 中查看。');
    if (!this.input.sessionId) throw new CodexError('Codex 压缩需要先选择已有会话。');
    if (this.input.text.trim()) throw new CodexError('Codex 手动压缩不支持附加参数。');
  }

  private async startTurn(client: CodexClient, threadId: string): Promise<AgentEvent> {
    if (this.input.invocation?.kind === 'skill')
      await validateCodexSkill(client, this.input.workspace.localDir, this.input.invocation);
    this.ensureActive();
    this.phase = 'starting';
    await this.sendTurn(client, threadId);
    await this.waitForStart(client);
    const turn = await Promise.race([
      this.turnCompleted,
      client.closed.then(() => {
        throw new CodexError('Codex 进程在轮次完成前退出。');
      }),
    ]);
    for (const event of this.mapper.finishItems(turn)) this.input.emit(event);
    for (const event of this.mapper.finishCompaction(text(turn.status))) this.input.emit(event);
    if (this.manualCompaction && turn.status === 'completed' && !this.mapper.compactionConfirmed())
      throw new CodexError('Codex 未确认本次压缩完成，请重新读取会话状态。');
    if (turn.status === 'failed')
      this.input.emit({ type: 'error', message: 'Codex 本轮执行失败，请检查本机模型与工具配置。' });
    return turnEnd(turn);
  }

  private turnResult?: RecordValue;
  private turnResolve?: (turn: RecordValue) => void;
  private readonly turnCompleted = new Promise<RecordValue>((resolve) => {
    this.turnResolve = resolve;
  });

  private async sendTurn(client: CodexClient, threadId: string): Promise<void> {
    if (this.manualCompaction) {
      for (const event of this.mapper.startManualCompaction()) this.input.emit(event);
      this.ensureActive();
      await client.request('thread/compact/start', { threadId });
      return;
    }
    const response = await client.request('turn/start', {
      threadId,
      input: this.inputItems(),
      ...(this.input.model ? { model: this.input.model } : {}),
      ...(this.input.reasoningEffort ? { effort: this.input.reasoningEffort } : {}),
    });
    const id = text(record(response.turn).id);
    if (!id || (this.turnId && this.turnId !== id)) throw new CodexError('Codex 未返回有效的轮次标识。');
    this.identifyTurn(id);
  }

  private inputItems(): RecordValue[] {
    const items: RecordValue[] = [];
    if (this.input.text.trim()) items.push({ type: 'text', text: this.input.text, text_elements: [] });
    const invocation = this.input.invocation;
    if (invocation?.kind === 'skill') items.push({ type: 'skill', name: invocation.name, path: invocation.path });
    if (!items.length) throw new CodexError('请输入消息或选择技能。');
    return items;
  }

  private async waitForStart(client: CodexClient): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.started,
        client.closed.then(() => {
          throw new CodexError('Codex 在轮次开始前退出。');
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CodexError('Codex 未发送轮次开始通知。')), TURN_START_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private identifyTurn(id: string): void {
    if (!id || this.phase === 'done' || (this.turnId && this.turnId !== id)) return;
    this.turnId = id;
    this.phase = 'running';
    this.start();
    if (this.stopped) this.sendInterrupt();
    for (const event of this.earlyNotifications.splice(0)) this.currentNotification(event.method, event.params);
  }

  private threadNotification(method: string, params: RecordValue): boolean {
    if (method === 'serverRequest/resolved') {
      this.permissions?.resolved(params.requestId);
      return true;
    }
    if (method !== 'thread/tokenUsage/updated') return false;
    if (!this.turnId || params.turnId === this.turnId)
      for (const event of this.mapper.map(method, params)) this.input.emit(event);
    return true;
  }

  private currentNotification(method: string, params: RecordValue): void {
    const eventTurnId = text(params.turnId) || text(record(params.turn).id);
    if (eventTurnId !== this.turnId) return;
    if (method === 'turn/completed') {
      const turn = record(params.turn);
      if (turn.id === this.turnId && !this.turnResult) {
        this.turnResult = turn;
        this.turnResolve?.(turn);
      }
      return;
    }
    for (const event of this.mapper.map(method, params)) this.input.emit(event);
  }

  private sendInterrupt(): void {
    if (!this.turnId || !this.client || this.interruptSent) return;
    this.interruptSent = true;
    void this.client
      .request('turn/interrupt', { threadId: this.runtime.sessionId ?? '', turnId: this.turnId })
      .catch(() => this.client?.terminate());
  }
}
