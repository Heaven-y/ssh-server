import type { AgentEvent, SessionSummary, Workspace } from '@agentdeck/shared';
import type { NativeInvocation } from './capability-types';

export type PermissionAnswer = { allow: boolean; message?: string };
export type AgentTurnInput = {
  workspace: Workspace;
  sessionId?: string;
  model?: string;
  reasoningEffort?: string;
  text: string;
  invocation?: NativeInvocation;
  emit(event: AgentEvent): void;
  requestPermission(request: { requestId: string; toolName: string; input: unknown }): Promise<PermissionAnswer>;
};
export type TurnHandle = { interrupt(): Promise<void>; done: Promise<void> };
export type TurnRunner = ((input: AgentTurnInput) => TurnHandle) & {
  /** 关闭长驻运行时；单轮实现可省略。 */
  dispose?(): Promise<void>;
};
export type NativeSessionSummary = Omit<SessionSummary, 'agent'>;
export type NativeSessionRead = {
  session: NativeSessionSummary;
  cwd: string;
  events: AgentEvent[];
  actualModel?: string;
};
/** 分叉只返回新会话的原生身份与目录，不复制历史为新的输入。 */
export type NativeSessionFork = Pick<NativeSessionRead, 'session' | 'cwd'>;
