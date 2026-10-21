// 长驻 Claude 运行时：一个原生进程承载同一会话的多轮对话，空闲超时后回收。
import { randomUUID } from 'node:crypto';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ssh-server/shared';
import type { AgentTurnInput, TurnEnv, TurnHandle } from './types';
import { claudeInvocationText } from './claude-capabilities';
import { claudeEffort } from './claude-effort';
import { ClaudeCompactionTracker } from './claude-compaction';
import { ClaudeEventMapper } from './claude-mapper';
import { isInsideDir } from './edit-scope';
import { buildInstructions } from './instructions';
import {
  claudeControl,
  createClaudeStream,
  nativeClaudeQuery,
  readClaudeContext,
  type ClaudeQuery,
  type QueryFn,
} from './claude-query';
import { MCP_SERVER_NAME, resolveRemoteToolsCommand } from '../remote-tools/launch';

export const PERMISSION_TIMEOUT_MS = 300_000;
const ABORT_FALLBACK_MS = 5_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const ALLOWED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__remote_exec`,
  `mcp__${MCP_SERVER_NAME}__remote_peek`,
  `mcp__${MCP_SERVER_NAME}__sync_now`,
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
];
/** 手动压缩是控制操作，原生保留/重放的对话不能作为本轮新增内容。 */
const COMPACTION_EVENTS = new Set<AgentEvent['type']>(['session', 'context', 'compaction', 'turn_end', 'error']);
type TurnEnd = Extract<AgentEvent, { type: 'turn_end' }>;

export type ClaudeTurnInput = AgentTurnInput & { queryFn?: QueryFn };

const commandIs = (input: AgentTurnInput, name: 'context' | 'compact') =>
  input.invocation?.kind === 'command' && input.invocation.name === name;
const isResult = (message: unknown): boolean =>
  !!message &&
  typeof message === 'object' &&
  'type' in message &&
  message.type === 'result' &&
  !('parent_tool_use_id' in message && message.parent_tool_use_id);

/** Windows 上子进程缺少 PATH、SystemRoot 会起不来，所以在 process.env 基础上合并 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return { ...env, ...extra };
}

function editTarget(input: Record<string, unknown>): string | undefined {
  const p = input.file_path ?? input.notebook_path;
  return typeof p === 'string' ? p : undefined;
}

/** 单轮状态：事件过滤、压缩跟踪与结束判定都属于这一轮，不属于进程。 */
class ClaudeTurn {
  readonly done: Promise<void>;
  readonly abort = new AbortController();
  private settle!: () => void;
  private ended = false;
  private stopped = false;
  private readonly manual: boolean;
  private readonly compaction: ClaudeCompactionTracker;
  private fallback?: NodeJS.Timeout;

  constructor(readonly input: AgentTurnInput) {
    this.manual = commandIs(input, 'compact');
    this.compaction = new ClaudeCompactionTracker(this.manual);
    this.done = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
  }

  get active(): boolean {
    return !this.ended;
  }

  deliver(event: AgentEvent): void {
    if (this.ended) return;
    if (this.manual && !COMPACTION_EVENTS.has(event.type)) return;
    if (event.type === 'compaction') {
      const state = this.compaction.observe(event.state, this.stopped);
      if (state) this.input.emit({ type: 'compaction', state });
      return;
    }
    this.input.emit(event);
  }

  /** 原生 result 已到达：先收尾压缩状态，再输出本轮结束。 */
  complete(event: TurnEnd): void {
    if (this.ended) return;
    this.finishCompaction();
    this.input.emit({ ...event, isError: event.isError || this.compaction.manualFailed || this.stopped });
    this.end();
  }

  /** 中断或进程退出：已收到的事件保留，本轮以错误结束。 */
  fail(message?: string): void {
    if (this.ended) return;
    if (message) this.input.emit({ type: 'error', message });
    this.finishCompaction();
    this.input.emit({ type: 'turn_end', isError: true });
    this.end();
  }

  markStopped(): void {
    this.stopped = true;
  }

  /** 中断已生效时不再投递新的用户消息。 */
  get cancelled(): boolean {
    return this.stopped;
  }

  private finishCompaction(): void {
    const state = this.compaction.finish(this.stopped);
    if (state) this.input.emit({ type: 'compaction', state });
  }

  private end(): void {
    this.ended = true;
    clearTimeout(this.fallback);
    this.settle();
  }
}

export class ClaudeRuntime {
  private readonly stream = createClaudeStream();
  private readonly mapper = new ClaudeEventMapper();
  private readonly query?: ClaudeQuery;
  private readonly consumer: Promise<void>;
  private readonly env: TurnEnv;
  private current?: ClaudeTurn;
  private closing?: Promise<void>;
  private broken = false;
  /** 原生进程创建失败的原因；构造不抛错，改在轮次里按错误收尾。 */
  private launchError?: Error;
  sessionId?: string;

  constructor(private readonly input: ClaudeTurnInput) {
    const { workspace } = input;
    const effort = claudeEffort(input.reasoningEffort);
    const remoteTools = resolveRemoteToolsCommand();
    // 令牌随运行时存活：MCP 子进程在创建时拿到它，换令牌会让后续轮次失效。
    this.env = input.acquireEnv();
    const options = {
      cwd: workspace.localDir,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: buildInstructions(workspace) },
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'stdio',
          command: remoteTools.command,
          args: remoteTools.args,
          env: childEnv(this.env.env),
        },
      },
      allowedTools: ALLOWED_TOOLS,
      canUseTool: (toolName: string, toolInput: Record<string, unknown>, opts: { signal: AbortSignal }) =>
        this.permission(toolName, toolInput, opts),
      includePartialMessages: true,
      ...(input.sessionId ? { resume: input.sessionId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(effort ? { effort } : {}),
    } as unknown as Options;
    this.sessionId = input.sessionId;
    try {
      this.query = (input.queryFn ?? nativeClaudeQuery)({ prompt: this.stream.prompt, options });
    } catch (error) {
      // 原生进程创建失败不能让构造方抛错，改由首轮产出错误事件收尾。
      this.broken = true;
      this.launchError = error instanceof Error ? error : new Error('Claude 原生进程启动失败');
      this.consumer = Promise.resolve();
      return;
    }
    this.consumer = this.consume();
  }

  get alive(): boolean {
    return !this.broken && this.closing === undefined;
  }

  run(input: AgentTurnInput): TurnHandle {
    if (this.current?.active) throw new Error('Claude 运行时正在处理另一轮对话');
    const turn = new ClaudeTurn(input);
    this.current = turn;
    // 原生进程没起来时不再尝试投递，直接以启动错误收尾本轮。
    if (this.launchError) turn.fail(this.launchError.message);
    else void this.start(turn);
    return {
      interrupt: () => this.interrupt(turn),
      done: turn.done.then(() => {
        if (this.current === turn) this.current = undefined;
      }),
    };
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    this.stream.close();
    try {
      this.query?.close();
    } catch {
      // 进程已退出时关闭是幂等的。
    }
    this.current?.fail();
    await this.consumer.catch(() => undefined);
    this.env.release();
  }

  /** 连续消费原生消息：跨轮保持同一迭代器，逐条投递给当前轮次。 */
  private async consume(): Promise<void> {
    try {
      for await (const message of this.query!) await this.dispatch(message);
      this.broken = true;
      this.current?.fail('Claude 原生进程已退出，请重新发送');
    } catch (error) {
      this.broken = true;
      if (!this.closing) this.current?.fail(error instanceof Error ? error.message : 'Claude 本轮运行失败');
    }
  }

  /** 单条原生消息的分发：轮次结束消息单独收尾，其余按事件映射后投递。 */
  private async dispatch(message: unknown): Promise<void> {
    const turn = this.current;
    if (turn?.active && isResult(message)) {
      await this.finishTurn(turn, message);
      return;
    }
    for (const event of this.mapper.map(message)) {
      if (event.type === 'session') this.sessionId = event.sessionId;
      if (turn?.active) turn.deliver(event);
    }
  }

  private async finishTurn(turn: ClaudeTurn, message: unknown): Promise<void> {
    turn.deliver({ type: 'context', usage: await readClaudeContext(this.query!) });
    let ended = false;
    for (const event of this.mapper.map(message)) {
      if (event.type === 'turn_end') {
        ended = true;
        turn.complete(event);
      } else {
        turn.deliver(event);
      }
    }
    if (!ended) turn.complete({ type: 'turn_end', isError: false });
  }

  private async start(turn: ClaudeTurn): Promise<void> {
    try {
      if (turn.input.invocation?.kind === 'command' && !this.sessionId) throw new Error('此 Claude 命令需要已有会话');
      if (commandIs(turn.input, 'context')) {
        const usage = await readClaudeContext(this.query!, turn.abort.signal);
        turn.deliver({ type: 'context', usage });
        turn.complete({ type: 'turn_end', isError: usage === null });
        return;
      }
      const text = await claudeInvocationText(this.query!, turn.input.invocation, turn.input.text, turn.abort.signal);
      // 中断已经生效时不再投递正文，避免取消后仍向原生进程发送用户消息。
      if (!turn.active || turn.cancelled) return;
      this.stream.send(text);
    } catch (error) {
      if (turn.active) turn.fail(error instanceof Error ? error.message : 'Claude 本轮运行失败');
    }
  }

  private async interrupt(turn: ClaudeTurn): Promise<void> {
    if (!turn.active) return;
    turn.markStopped();
    turn.abort.abort();
    try {
      await claudeControl(this.query!.interrupt(), undefined, ABORT_FALLBACK_MS);
    } catch {
      // 原生拒绝中断时关闭运行时，避免残留无法取消的轮次。
      await this.close();
      return;
    }
    // 原生已确认中断：本轮立即收尾，否则长驻运行时会在没有后续事件时一直挂着。
    if (turn.active) turn.fail('本轮已中断');
  }

  /** canUseTool 由运行时创建一次，按调用时的活动轮次解析，避免令牌泄漏到旧轮次。 */
  private async permission(
    toolName: string,
    toolInput: Record<string, unknown>,
    opts: { signal: AbortSignal },
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    const turn = this.current;
    if (!turn?.active) return { behavior: 'deny', message: '本轮已结束' };
    const target = editTarget(toolInput);
    if (EDIT_TOOLS.has(toolName) && target && isInsideDir(turn.input.workspace.localDir, target)) {
      return { behavior: 'allow', updatedInput: toolInput };
    }
    const requestId = randomUUID();
    turn.input.emit({ type: 'permission_request', requestId, toolName, input: toolInput });
    const answer = await waitAnswer(
      turn.input.requestPermission({ requestId, toolName, input: toolInput }),
      opts.signal,
    );
    turn.input.emit({ type: 'permission_resolved', requestId, decision: answer.allow ? 'allowed' : 'denied' });
    return answer.allow
      ? { behavior: 'allow', updatedInput: toolInput }
      : { behavior: 'deny', message: answer.message ?? '用户拒绝' };
  }
}

/** 等待网页答复；超时或被中断时拒绝 */
function waitAnswer(
  pending: Promise<{ allow: boolean; message?: string }>,
  signal: AbortSignal,
): Promise<{ allow: boolean; message?: string }> {
  if (signal.aborted) return Promise.resolve({ allow: false, message: '本轮已中断' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (a: { allow: boolean; message?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(a);
    };
    const timer = setTimeout(() => finish({ allow: false, message: '等待确认超时，已拒绝' }), PERMISSION_TIMEOUT_MS);
    const onAbort = () => finish({ allow: false, message: '本轮已中断' });
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(finish, () => finish({ allow: false, message: '确认请求失败' }));
  });
}
