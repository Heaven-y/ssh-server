import path from 'node:path';
import { NativeSessionIdSchema, type AgentEvent } from '@agentdeck/shared/conversation';
import { stepDuration, stepUsage } from './metrics';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const clip = (value: string) => (value.length > 20_000 ? `${value.slice(0, 20_000)}\n[输出已截断]` : value);
const toolOutput = (info: RecordValue) =>
  clip(text(info.output)) || clip(text(record(info.error).message)) || (info.error ? '工具执行失败' : '');
const toolFinished = (state: unknown) => state === 'DONE' || state === 'ERROR';
const toolFailed = (state: unknown, info: RecordValue) => state === 'ERROR' || !!info.error;

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
    if (step.step_type === 'agent_response') {
      const delta = text(step.text_delta);
      if (delta) this.streamed = true;
      return [...(delta ? [{ type: 'text' as const, delta }] : []), ...this.stepStatistics(step)];
    }
    if (step.step_type === 'checkpoint') return this.checkpoint(step);
    if (Array.isArray(record(step.subagent_info).subagents)) return this.subagentStep(step);
    return step.step_type === 'tool' ? this.tool(step) : [];
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
    if (toolFinished(step.state) && !this.results.has(id)) {
      this.results.add(id);
      const isError = toolFailed(step.state, info);
      const usage = stepUsage(step.usage, true);
      events.push({
        type: 'tool_result',
        id,
        output: toolOutput(info),
        isError,
        ...stepDuration(step.duration_seconds),
        ...(usage ? { usage } : {}),
      });
    }
    return events;
  }

  private finish(result: RecordValue): AgentEvent[] {
    if (this.result) return [];
    if (result.status === 'SUCCESS' && !this.initialized) throw new Error('Antigravity 未完成会话初始化');
    if (result.status === 'SUCCESS' || result.conversation_id) this.identity(result.conversation_id);
    const events: AgentEvent[] = [];
    if (!this.streamed && text(result.response)) events.push({ type: 'text', delta: text(result.response) });
    const isError = result.status !== 'SUCCESS';
    if (isError)
      events.push({ type: 'error', message: 'Antigravity 未成功完成本轮，请检查原生模型、登录状态与权限配置。' });
    this.result = {
      type: 'turn_end',
      isError,
      // result 的 duration/usage 在续接时可能累计；单步统计独立保留，不冒充整轮。
    };
    return events;
  }
}
