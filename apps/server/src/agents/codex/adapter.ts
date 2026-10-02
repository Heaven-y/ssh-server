import type { AgentEvent } from '@ssh-server/shared';
import type { AgentTurnInput, TurnHandle } from '../types';
import { sameSessionDirectory } from '../session-scope';
import { CodexClient } from './client';
import { threadParams } from './config';
import { CodexEventMapper, turnEnd } from './mapper';
import { CodexPermissions } from './permissions';
import { checkedThread } from './sessions';
import { cancelled, CodexError, record, safeError, text, type CodexRuntimeOptions, type RecordValue } from './types';

const INTERRUPT_FALLBACK_MS = 5_000;

class CodexTurn {
  private readonly preparation = new AbortController();
  private readonly mapper = new CodexEventMapper();
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
  private readonly onAbort = () => {
    void this.interrupt();
  };

  constructor(
    private readonly input: AgentTurnInput,
    private readonly options: CodexRuntimeOptions,
  ) {
    this.completed = new Promise((resolve) => {
      this.complete = resolve;
    });
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
    if (options.signal?.aborted) this.stopped = true;
  }

  async run(): Promise<void> {
    let end: AgentEvent = { type: 'turn_end', isError: false };
    try {
      this.ensureActive();
      this.client = await CodexClient.start({
        ...this.options,
        env: { ...this.options.env, ...this.input.mcpEnv },
        cwd: this.input.workspace.localDir,
        signal: this.preparation.signal,
      });
      this.permissions = new CodexPermissions(this.client, this.input, this.mapper);
      this.client.onRequest = (request) => {
        if (this.threadId && request.params.threadId !== this.threadId) this.client?.rejectRequest(request.id);
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
      await this.client?.close();
      this.input.emit(end);
    }
  }

  private ensureActive(): void {
    if (this.stopped) throw cancelled();
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
    const response = await client.request(id ? 'thread/resume' : 'thread/start', {
      ...params,
      ...(id ? { threadId: id, excludeTurns: true } : {}),
    });
    const thread = record(response.thread);
    if (!text(thread.id) || !(await sameSessionDirectory(text(thread.cwd), this.input.workspace.localDir))) {
      throw new CodexError('Codex 返回了不属于当前工作区的会话。');
    }
    if (id && thread.id !== id) throw new CodexError('Codex 返回的会话标识与续接目标不一致。');
    this.threadId = text(thread.id);
    this.input.emit({
      type: 'session',
      sessionId: this.threadId,
      model: text(response.model) || text(thread.model),
      cwd: text(thread.cwd),
      agent: 'codex',
    });
  }

  private async startTurn(client: CodexClient): Promise<AgentEvent> {
    this.phase = 'starting';
    const response = await client.request('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: this.input.text, text_elements: [] }],
      ...(this.input.model ? { model: this.input.model } : {}),
      ...(this.input.reasoningEffort ? { effort: this.input.reasoningEffort } : {}),
    });
    this.turnId = text(record(response.turn).id);
    if (!this.turnId) throw new CodexError('Codex 未返回有效的轮次标识。');
    this.phase = 'running';
    if (this.stopped) this.sendInterrupt();
    const turn = await Promise.race([
      this.completed,
      client.closed.then(() => {
        throw new CodexError('Codex 进程在轮次完成前退出。');
      }),
    ]);
    for (const event of this.mapper.finishItems(turn)) this.input.emit(event);
    if (turn.status === 'failed')
      this.input.emit({ type: 'error', message: 'Codex 本轮执行失败，请检查本机模型与工具配置。' });
    return turnEnd(turn);
  }

  private notification(method: string, params: RecordValue): void {
    if (!this.threadId || params.threadId !== this.threadId) return;
    if (this.turnId && params.turnId && params.turnId !== this.turnId) return;
    if (method === 'turn/completed') {
      this.complete(record(params.turn));
      return;
    }
    if (method === 'serverRequest/resolved') {
      this.permissions?.resolved(params.requestId);
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
