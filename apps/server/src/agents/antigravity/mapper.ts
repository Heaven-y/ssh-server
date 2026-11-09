import path from 'node:path';
import { NativeSessionIdSchema, type AgentEvent } from '@agentdeck/shared/conversation';
import { stepDuration, stepUsage } from './metrics';
import { ANTIGRAVITY_PERMISSION_NOTICE, antigravityDiagnostic } from './diagnostics';

type RecordValue = Record<string, unknown>;
type DiagnosticEvent = Extract<AgentEvent, { type: 'error' | 'activity' }>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const clip = (value: string) => (value.length > 20_000 ? `${value.slice(0, 20_000)}\n[输出已截断]` : value);
const toolOutput = (info: RecordValue) => {
  const error = antigravityDiagnostic(text(record(info.error).message));
  if (error?.type === 'error') return error.message;
  return clip(text(info.output)) || clip(text(record(info.error).message)) || (info.error ? '工具执行失败' : '');
};
const toolFinished = (state: unknown) => state === 'DONE' || state === 'ERROR';
const toolFailed = (state: unknown, info: RecordValue) => state === 'ERROR' || !!info.error;
const currentStepFailed = (step: RecordValue) =>
  step.step_type === 'error_message' ||
  step.state === 'ERROR' ||
  step.state === 'CANCELLED' ||
  !!record(step.tool_info).error;

function mayContainHistoricalError(result: RecordValue): boolean {
  return (
    result.status === 'ERROR' &&
    !!text(result.error).trim() &&
    !!text(result.response).trim() &&
    Number.isSafeInteger(result.num_turns) &&
    Number(result.num_turns) > 1
  );
}

/** 按官方 headless 的 event/payload 结构映射，不能把它当成 Claude stream-json。 */
export class AntigravityMapper {
  private sessionId?: string;
  private streamed = false;
  private tools = new Set<string>();
  private results = new Set<string>();
  private initialized = false;
  private statistics = new Set<number>();
  private checkpoints = new Set<number>();
  private subagents = new Map<number, string>();
  private inputIndex?: number;
  private latestStep?: { index: number; type: string; state: string; hasText: boolean };
  private currentFailure = false;
  private historicalErrorPossible = false;
  private resultDiagnostic?: DiagnosticEvent;
  result?: Extract<AgentEvent, { type: 'turn_end' }>;

  constructor(
    private readonly cwd: string,
    private readonly expectedId?: string,
  ) {}

  map(value: unknown): AgentEvent[] {
    const event = record(value);
    switch (event.event) {
      case 'init':
        return this.initialize(event);
      case 'step_update':
        return this.step(record(event.step_update));
      case 'result':
        return this.finish(record(event.result));
      default:
        return [];
    }
  }

  private identity(value: unknown): string {
    const parsed = NativeSessionIdSchema.safeParse(value);
    if (!parsed.success) throw new Error('Antigravity 未报告有效的会话身份');
    const id = parsed.data;
    if ((this.expectedId && id !== this.expectedId) || (this.sessionId && id !== this.sessionId))
      throw new Error('Antigravity 会话身份发生变化，已停止本轮');
    this.sessionId = id;
    return id;
  }

  private initialize(event: RecordValue): AgentEvent[] {
    const init = record(event.init);
    const sessionId = this.identity(event.conversation_id);
    const reported = text(init.cwd);
    const normalize = (dir: string) =>
      process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir);
    if (!reported || normalize(reported) !== normalize(this.cwd))
      throw new Error('Antigravity 返回的项目目录不匹配，已停止本轮');
    this.initialized = true;
    return [{ type: 'session', sessionId, agent: 'antigravity', cwd: this.cwd, model: text(init.model) }];
  }

  private step(step: RecordValue): AgentEvent[] {
    if (!this.initialized) throw new Error('Antigravity 未完成会话初始化');
    this.identity(step.conversation_id);
    this.observeCompletion(step);
    if (step.step_type === 'agent_response') {
      const delta = text(step.text_delta);
      if (delta) this.streamed = true;
      return [...(delta ? [{ type: 'text' as const, delta }] : []), ...this.stepStatistics(step)];
    }
    if (step.step_type === 'checkpoint') return this.checkpoint(step);
    if (Array.isArray(record(step.subagent_info).subagents)) return this.subagentStep(step);
    return step.step_type === 'tool' ? this.tool(step) : [];
  }

  private observeCompletion(step: RecordValue): void {
    if (!Number.isSafeInteger(step.step_index) || Number(step.step_index) < 0) {
      this.currentFailure = true;
      return;
    }
    const index = Number(step.step_index);
    const type = text(step.step_type);
    const state = text(step.state);
    this.observeInput(index, type, state);
    // 输入边界前已出现步骤时，无法确定当前轮范围，后续不再纠正累计失败。
    if (this.inputIndex === undefined) {
      this.currentFailure = true;
      return;
    }
    if (index <= this.inputIndex) return;
    this.currentFailure ||= currentStepFailed(step);
    this.observeLatest(index, type, state, step.text_delta);
  }

  private observeInput(index: number, type: string, state: string): void {
    if (type === 'user_input' && state === 'DONE') {
      if (this.inputIndex === undefined) this.inputIndex = index;
      // 同一输入的重复事件不重置状态；多个不同输入边界不足以确认本轮。
      else if (this.inputIndex !== index) this.currentFailure = true;
    }
  }

  private observeLatest(index: number, type: string, state: string, delta: unknown): void {
    if (this.latestStep && index < this.latestStep.index) return;
    const hasText = type === 'agent_response' && !!text(delta).trim();
    this.latestStep = {
      index,
      type,
      state,
      hasText: hasText || (this.latestStep?.index === index && this.latestStep.hasText),
    };
  }

  private completedResponse(): boolean {
    return (
      !!this.expectedId &&
      this.inputIndex !== undefined &&
      this.inputIndex > 0 &&
      !this.currentFailure &&
      this.latestStep?.type === 'agent_response' &&
      this.latestStep.state === 'DONE' &&
      this.latestStep.hasText
    );
  }

  /** 原生累计 result 会保留历史 ERROR；只以本轮完整答复和自然退出的共同证据纠正。 */
  complete(naturalSuccess: boolean): DiagnosticEvent[] {
    if (this.result && naturalSuccess && this.completedResponse() && this.historicalErrorPossible)
      this.result = { ...this.result, isError: false };
    return this.result?.isError && this.resultDiagnostic ? [this.resultDiagnostic] : [];
  }

  private stepStatistics(step: RecordValue): AgentEvent[] {
    if (!Number.isSafeInteger(step.step_index) || Number(step.step_index) < 0 || step.state !== 'DONE') return [];
    const index = Number(step.step_index);
    if (this.statistics.has(index)) return [];
    const usage = stepUsage(step.usage, true);
    if (!usage) return [];
    this.statistics.add(index);
    return [{ type: 'step_usage', id: `agy-step-${index}`, usage, ...stepDuration(step.duration_seconds) }];
  }

  private checkpoint(step: RecordValue): AgentEvent[] {
    if (!Number.isSafeInteger(step.step_index) || Number(step.step_index) < 0 || step.state !== 'DONE') return [];
    const index = Number(step.step_index);
    if (this.checkpoints.has(index)) return [];
    this.checkpoints.add(index);
    return [{ type: 'compaction', state: { status: 'completed' } }, ...this.stepStatistics(step)];
  }

  private subagentStep(step: RecordValue): AgentEvent[] {
    if (!Number.isSafeInteger(step.step_index) || Number(step.step_index) < 0) return [];
    const index = Number(step.step_index);
    const state = text(step.state);
    if (this.subagents.get(index) === state) return [];
    this.subagents.set(index, state);
    const children: unknown[] = record(step.subagent_info).subagents as unknown[];
    const input = {
      subagents: children.map((value) => {
        const child = record(value);
        return { type: child.type_name, role: child.role, sessionId: child.conversation_id };
      }),
    };
    return [
      {
        type: 'activity',
        id: `agy-step-${index}`,
        name: '子代理',
        status: state === 'DONE' ? 'completed' : 'running',
        input,
        ...stepDuration(step.duration_seconds),
      },
    ];
  }

  private tool(step: RecordValue): AgentEvent[] {
    if (!Number.isSafeInteger(step.step_index) || Number(step.step_index) < 0) return [];
    const id = `agy-step-${String(step.step_index)}`;
    const info = record(step.tool_info);
    const name = text(info.name) || text(step.tool_name);
    if (!name) return [];
    const events: AgentEvent[] = [];
    if (!this.tools.has(id)) {
      this.tools.add(id);
      events.push({ type: 'tool_call', id, name, input: info.parameters ?? {} });
    }
    if (toolFinished(step.state) && !this.results.has(id)) events.push(...this.toolResult(id, step, info));
    return events;
  }

  private toolResult(id: string, step: RecordValue, info: RecordValue): AgentEvent[] {
    this.results.add(id);
    const usage = stepUsage(step.usage, true);
    const events: AgentEvent[] = [
      {
        type: 'tool_result',
        id,
        output: toolOutput(info),
        isError: toolFailed(step.state, info),
        ...stepDuration(step.duration_seconds),
        ...(usage ? { usage } : {}),
      },
    ];
    const diagnostic = antigravityDiagnostic(text(record(info.error).message));
    if (diagnostic?.type === 'error') events.push(diagnostic);
    return events;
  }

  private finish(result: RecordValue): AgentEvent[] {
    if (this.result) return [];
    if (result.status === 'SUCCESS' && !this.initialized) throw new Error('Antigravity 未完成会话初始化');
    if (result.status === 'SUCCESS' || result.conversation_id) this.identity(result.conversation_id);
    const events: AgentEvent[] = [];
    if (!this.streamed && text(result.response)) events.push({ type: 'text', delta: text(result.response) });
    const isError = result.status !== 'SUCCESS';
    events.push(...this.prepareResult(result));
    this.result = {
      type: 'turn_end',
      isError,
      // result 的 duration/usage 在续接时可能累计；单步统计独立保留，不冒充整轮。
    };
    return events;
  }

  private prepareResult(result: RecordValue): AgentEvent[] {
    if (result.status !== 'SUCCESS') this.resultDiagnostic = antigravityDiagnostic(text(result.error));
    const hasDeniedActions = Array.isArray(result.denied_actions) && result.denied_actions.length > 0;
    this.historicalErrorPossible =
      !hasDeniedActions && result.conversation_id === this.expectedId && mayContainHistoricalError(result);
    return hasDeniedActions ? [{ type: 'error', message: ANTIGRAVITY_PERMISSION_NOTICE }] : [];
  }
}
