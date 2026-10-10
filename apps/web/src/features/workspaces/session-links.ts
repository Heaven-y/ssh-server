import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema, type SessionRef } from '@ssh-server/shared';

export type SessionLocation = SessionRef & { workspaceId: string };
const LinkSchema = z
  .object({ workspace: NativeSessionIdSchema, agent: AgentKindSchema, id: NativeSessionIdSchema })
  .strict();
const invalidLink = () => new Error('会话链接格式无效，请重新复制完整链接');

/** 链接只负责本网页定位，不承诺原生客户端 URI 或向 Agent 注入上下文。 */
export function sessionLink(location: SessionLocation, base: string): string {
  const value = LinkSchema.parse({ workspace: location.workspaceId, agent: location.agent, id: location.sessionId });
  const url = new URL(base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidLink();
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = `session?${new URLSearchParams(value).toString()}`;
  return url.href;
}

export function parseSessionLink(hash: string): SessionLocation | undefined {
  if (!hash || hash === '#') return undefined;
  if (hash.length > 1024 || !hash.startsWith('#session?')) throw invalidLink();
  const params = new URLSearchParams(hash.slice('#session?'.length));
  const result = LinkSchema.safeParse(Object.fromEntries(params));
  if (params.size !== 3 || !result.success) throw invalidLink();
  return { workspaceId: result.data.workspace, agent: result.data.agent, sessionId: result.data.id };
}
