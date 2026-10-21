import type { AgentEvent, SessionSummary, Workspace } from '@ssh-server/shared';
import type { NativeInvocation } from './capability-types';

export type PermissionAnswer = { allow: boolean; message?: string };
/** 内部服务地址与临时令牌；释放后令牌立即失效。 */
export type TurnEnv = { env: Record<string, string>; release(): void };
export type AgentTurnInput = {
  workspace: Workspace;
  sessionId?: string;
  model?: string;
  reasoningEffort?: string;
  text: string;
  invocation?: NativeInvocation;
  /**
   * 登记内部令牌并返回本轮运行环境。
   * 单轮实现用后立即释放；长驻运行时复用首次租约，在运行时关闭时释放，
   * 否则已在运行的 MCP 子进程会持有失效令牌。
   */
  acquireEnv(): TurnEnv;
  emit(event: AgentEvent): void;
  requestPermission(request: { requestId: string; toolName: string; input: unknown }): Promise<PermissionAnswer>;
};
export type TurnHandle = { interrupt(): Promise<void>; done: Promise<void> };
export type TurnRunner = ((input: AgentTurnInput) => TurnHandle) & {
  /** 关闭长驻运行时并释放其持有的令牌；单轮实现可省略。 */
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
