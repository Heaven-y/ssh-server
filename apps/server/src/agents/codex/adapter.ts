import type { AgentEvent } from '@ssh-server/shared';
import type { AgentTurnInput, TurnHandle } from '../types';
import { sameSessionDirectory } from '../session-scope';
import { CodexClient } from './client';
import { validateCodexSkill } from './capabilities';
import { threadParams } from './config';
import { CodexEventMapper, turnEnd } from './mapper';
import { CodexPermissions } from './permissions';
import { checkedThread } from './sessions';
import { cancelled, CodexError, record, safeError, text, type CodexRuntimeOptions, type RecordValue } from './types';

const INTERRUPT_FALLBACK_MS = 5_000;
const TURN_START_TIMEOUT_MS = 30_000;

class CodexTurn {
  private readonly preparation = new AbortController();
  private readonly mapper: CodexEventMapper;
  private readonly manualCompaction: boolean;
  private client?: CodexClient;
  private permissions?: CodexPermissions;
  private phase: 'preparing' | 'starting' | 'running' | 'done' = 'preparing';
  private stopped = false;
  private threadId = '';
  private turnId = '';
  private interruptSent = false;
  private interruptTimer?: NodeJS.Timeout;
  private readonly completed: Promise<RecordValue>;
  private complete!: (turn: RecordValue) => void;
  private readonly started: Promise<void>;
  private start!: () => void;
  private readonly earlyNotifications: Array<{ method: string; params: RecordValue }> = [];
  private readonly onAbort = () => {
    void this.interrupt();
  };

  constructor(
    private readonly input: AgentTurnInput,
    private readonly options: CodexRuntimeOptions,
  ) {
    this.manualCompaction = input.invocation?.kind === 'command' && input.invocation.name === 'compact';
    this.mapper = new CodexEventMapper({ manualCompaction: this.manualCompaction });
    this.completed = new Promise((resolve) => {
      this.complete = resolve;
    });
    this.started = new Promise((resolve) => {
      this.start = resolve;
    });
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (options.signal?.aborted) this.stopped = true;
  }

  async run(): Promise<void> {
    let end: AgentEvent = { type: 'turn_end', isError: false };
    try {
      this.ensureActive();
      this.validateInput();
      this.client = await CodexClient.start({
        ...this.options,
        env: { ...this.options.env, ...this.input.mcpEnv },
        cwd: this.input.workspace.localDir,
        signal: this.preparation.signal,
      });
      this.permissions = new CodexPermissions(this.client, this.input, this.mapper);
      this.client.onRequest = (request) => {
        if (this.foreignRequest(request.params)) this.client?.rejectRequest(request.id);
        else this.permissions?.request(request);
      };
      this.client.onNotification = (method, params) => this.notification(method, params);
      await this.prepare(this.client);
      this.ensureActive();
      end = await this.startTurn(this.client);
    } catch (error) {
      if (!this.stopped) {
        end = { type: 'turn_end', isError: true };
        this.input.emit({ type: 'error', message: safeError(error) });
      }
    } finally {
      this.phase = 'done';
      clearTimeout(this.interruptTimer);
      this.options.signal?.removeEventListener('abort', this.onAbort);
      this.permissions?.cancel();
      for (const event of this.mapper.finishCompaction(this.stopped ? 'interrupted' : 'failed')) this.input.emit(event);
      await this.client?.close();
      this.input.emit(end);
    }
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

  private foreignRequest(params: RecordValue): boolean {
    return (!!this.threadId && params.threadId !== this.threadId) || (!!this.turnId && params.turnId !== this.turnId);
  }

  private async prepare(client: CodexClient): Promise<void> {
    await client.initialize();
    this.ensureActive();
    const config = await client.request('config/read', { cwd: this.input.workspace.localDir, includeLayers: false });
    this.ensureActive();
    const params = threadParams(this.input, config);
    const id = this.input.sessionId;
    if (id) await checkedThread(client, id, this.input.workspace.localDir);
    this.ensureActive();
    // resume 可能在响应前重放该线程的上下文统计。
    if (id) this.threadId = id;
    const response = await client.request(id ? 'thread/resume' : 'thread/start', {
      ...params,
      ...(id ? { threadId: id, excludeTurns: true } : {}),
    });
    await this.acceptSession(response, id);
  }

  private async acceptSession(response: RecordValue, id?: string): Promise<void> {
    const thread = record(response.thread);
    if (!text(thread.id) || !(await sameSessionDirectory(text(thread.cwd), this.input.workspace.localDir))) {
      throw new CodexError('Codex 返回了不属于当前工作区的会话。');
    }
    if (id && thread.id !== id) throw new CodexError('Codex 返回的会话标识与续接目标不一致。');
    this.threadId = text(thread.id);
    this.mapper.setModel(text(response.model) || text(thread.model));
    this.input.emit({
      type: 'session',
      sessionId: this.threadId,
      model: text(response.model) || text(thread.model),
      cwd: text(thread.cwd),
      agent: 'codex',
    });
  }

  private async startTurn(client: CodexClient): Promise<AgentEvent> {
    if (this.input.invocation?.kind === 'skill')
      await validateCodexSkill(client, this.input.workspace.localDir, this.input.invocation);
    this.ensureActive();
    this.phase = 'starting';
    await this.sendTurn(client);
    await this.waitForStart(client);
    const turn = await Promise.race([
      this.completed,
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

  private async sendTurn(client: CodexClient): Promise<void> {
    if (this.manualCompaction) {
      for (const event of this.mapper.startManualCompaction()) this.input.emit(event);
      this.ensureActive();
      await client.request('thread/compact/start', { threadId: this.threadId });
      return;
    }
    const response = await client.request('turn/start', {
      threadId: this.threadId,
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

  private notification(method: string, params: RecordValue): void {
    if (!this.threadId || params.threadId !== this.threadId || this.phase === 'done') return;
    if (this.threadNotification(method, params) || this.phase === 'preparing') return;
    if (method === 'turn/started') {
      this.identifyTurn(text(record(params.turn).id));
      return;
    }
    if (!this.turnId) {
      if (this.earlyNotifications.length >= 128) this.client?.terminate(new CodexError('Codex 轮次开始前的通知过多。'));
      else this.earlyNotifications.push({ method, params });
      return;
    }
    this.currentNotification(method, params);
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
      this.complete(record(params.turn));
      return;
    }
    for (const event of this.mapper.map(method, params)) this.input.emit(event);
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

  private sendInterrupt(): void {
    if (!this.turnId || !this.client || this.interruptSent) return;
    this.interruptSent = true;
    void this.client
      .request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
      .catch(() => this.client?.terminate());
  }
}

export function runCodexTurn(input: AgentTurnInput, options: CodexRuntimeOptions = {}): TurnHandle {
  const turn = new CodexTurn(input, options);
  return { done: turn.run(), interrupt: () => turn.interrupt() };
}
