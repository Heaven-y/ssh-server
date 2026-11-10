import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema } from './agents';

export const SessionLocationSchema = z
  .object({
    workspaceId: NativeSessionIdSchema,
    agent: AgentKindSchema,
    sessionId: NativeSessionIdSchema,
  })
  .strict();
export type SessionLocation = z.infer<typeof SessionLocationSchema>;
const invalidLink = () => new Error('会话链接格式无效，请重新复制完整链接');

function referenceParams(location: SessionLocation): string {
  const value = SessionLocationSchema.parse(location);
  return new URLSearchParams({ workspace: value.workspaceId, agent: value.agent, id: value.sessionId }).toString();
}

/** 原生 ID 保持不变；链接绑定工作台项目，不依赖本机服务的临时端口。 */
export function formatSessionReference(location: SessionLocation): string {
  return `agentdeck://session?${referenceParams(location)}`;
}

export function sessionReferenceHash(location: SessionLocation): string {
  return `#session?${referenceParams(location)}`;
}

function readParams(reference: string): string {
  if (reference.startsWith('#session?')) return reference.slice('#session?'.length);
  const url = new URL(reference);
  if (url.username || url.password) throw invalidLink();
  if (url.protocol === 'agentdeck:') return nativeParams(url);
  if (['http:', 'https:'].includes(url.protocol) && url.hash.startsWith('#session?')) {
    return url.hash.slice('#session?'.length);
  }
  throw invalidLink();
}

function nativeParams(url: URL): string {
  if (url.hostname !== 'session' || url.port || url.pathname || url.hash) throw invalidLink();
  return url.search.slice(1);
}

/** 只解析身份，不获取 URL，也不把历史当作当前指令。 */
export function parseSessionReference(reference: string): SessionLocation {
  try {
    if (!reference || reference.length > 1024 || reference.trim() !== reference) throw invalidLink();
    const params = new URLSearchParams(readParams(reference));
    if (params.size !== 3 || [...params.keys()].some((key) => !['workspace', 'agent', 'id'].includes(key))) {
      throw invalidLink();
    }
    return SessionLocationSchema.parse({
      workspaceId: params.get('workspace'),
      agent: params.get('agent'),
      sessionId: params.get('id'),
    });
  } catch {
    throw invalidLink();
  }
}
