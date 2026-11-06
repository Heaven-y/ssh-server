import type { SessionForkInput } from '@agentdeck/shared/conversation';

/** 通过 Antigravity 自身服务管理会话，提供方仍负责归属和返回身份复核。 */
export type AntigravitySessionManagement = {
  /** 只读完整轨迹；实现必须先校验会话身份与工作区目录。 */
  readTrajectory?(
    id: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<{ trajectory: Record<string, unknown>; status?: string }>;
  rename?(id: string, dir: string, title: string): Promise<void>;
  delete(id: string, dir: string): Promise<void>;
  fork(id: string, dir: string, input: SessionForkInput): Promise<{ sessionId: string }>;
};
