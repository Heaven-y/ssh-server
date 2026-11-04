import type { AgentEvent, SessionRecord, Workspace } from '@agentdeck/shared';
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
/** 各 CLI 的原生会话行：只有原生元数据，不含项目归属与运行态。 */
export type NativeSessionSummary = Omit<SessionRecord, 'agent'> & {
  /** Antigravity 摘要里记录的工作区 URI；其它 CLI 通常没有。 */
  workspaceUris?: string;
};
export type NativeSessionRead = {
  session: NativeSessionSummary;
  cwd: string;
  events: AgentEvent[];
  actualModel?: string;
};
/** 分叉只返回新会话的原生身份与目录，不复制历史为新的输入。 */
export type NativeSessionFork = Pick<NativeSessionRead, 'session' | 'cwd'>;
