import path from 'node:path';
import { NativeSessionIdSchema, type AgentEvent } from '@agentdeck/shared';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const clip = (value: string) => (value.length > 20_000 ? `${value.slice(0, 20_000)}\n[输出已截断]` : value);
const toolOutput = (info: RecordValue) =>
  clip(text(info.output)) || (info.error ? '原生工具执行失败，请检查 CLI 诊断。' : '');
function durationOf(value: unknown): { durationMs?: number } {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { durationMs: value * 1000 } : {};
}

/** 按官方 headless 的 event/payload 结构映射，不能把它当成 Claude stream-json。 */
export class AntigravityMapper {
  private sessionId?: string;
  private streamed = false;
  private tools = new Set<string>();
  private results = new Set<string>();
  private initialized = false;
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
      return delta ? [{ type: 'text', delta }] : [];
    }
    return step.step_type === 'tool' ? this.tool(step) : [];
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
    if (step.state === 'DONE' && !this.results.has(id)) {
      this.results.add(id);
      const isError = !!info.error;
      events.push({ type: 'tool_result', id, output: toolOutput(info), isError });
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
      ...durationOf(result.duration_seconds),
    };
    return events;
  }
}
