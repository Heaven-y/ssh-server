import type { AgentEvent, Workspace } from '@ssh-server/shared';
import type { NativeInvocation } from './capability-types';

export type PermissionAnswer = { allow: boolean; message?: string };
export type AgentTurnInput = {
  workspace: Workspace;
  sessionId?: string;
  model?: string;
  reasoningEffort?: string;
  text: string;
  invocation?: NativeInvocation;
  /** 仅在本机进程环境中传递内部服务地址与临时令牌。 */
  mcpEnv: Record<string, string>;
  emit(event: AgentEvent): void;
  requestPermission(request: { requestId: string; toolName: string; input: unknown }): Promise<PermissionAnswer>;
};
export type TurnHandle = { interrupt(): Promise<void>; done: Promise<void> };
export type TurnRunner = (input: AgentTurnInput) => TurnHandle;
export type NativeSessionSummary = { sessionId: string; summary: string; lastModified: number };
export type NativeSessionRead = {
  session: NativeSessionSummary;
  cwd: string;
  events: AgentEvent[];
  actualModel?: string;
};
