// 会话令牌登记：每次 Agent 会话开始时生成令牌，MCP 子进程用它调用内部接口
import { randomBytes } from 'node:crypto';

export type SessionRegistry = {
  /** 登记并返回新的会话令牌 */
  register(workspaceId: string): string;
  /** 令牌对应的工作区 id */
  resolve(token: string): string | undefined;
  unregister(token: string): void;
};

export function createSessionRegistry(): SessionRegistry {
  const tokens = new Map<string, string>();
  return {
    register(workspaceId) {
      const token = randomBytes(32).toString('base64url');
      tokens.set(token, workspaceId);
      return token;
    },
    resolve: (token) => tokens.get(token),
    unregister: (token) => {
      tokens.delete(token);
    },
  };
}
