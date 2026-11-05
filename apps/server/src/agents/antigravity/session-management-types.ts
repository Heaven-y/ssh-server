import type { SessionForkInput } from '@agentdeck/shared';

/** 通过 Antigravity 自身服务管理会话，提供方仍负责归属和返回身份复核。 */
export type AntigravitySessionManagement = {
  rename?(id: string, dir: string, title: string): Promise<void>;
  delete(id: string, dir: string): Promise<void>;
  fork(id: string, dir: string, input: SessionForkInput): Promise<{ sessionId: string }>;
};
