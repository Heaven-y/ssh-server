// 会话列表与历史：直接读取 Claude Code 在本地保存的会话，网页本身不另存对话
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { FastifyInstance } from 'fastify';
import { ClaudeEventMapper } from '../agents/claude-mapper';
import type { WorkspaceStore } from '../workspaces/store';

export type SessionsApi = {
  list(dir: string): Promise<Array<{ sessionId: string; summary: string; lastModified: number }>>;
  messages(sessionId: string, dir: string): Promise<unknown[]>;
};

const defaultApi: SessionsApi = {
  list: (dir) => listSessions({ dir }),
  messages: (sessionId, dir) => getSessionMessages(sessionId, { dir }),
};

/** 会话 id 只允许字母、数字、- 和 _，防止拼进路径 */
const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function registerSessionRoutes(app: FastifyInstance, deps: { store: WorkspaceStore; api?: SessionsApi }): void {
  const api = deps.api ?? defaultApi;

  app.get<{ Params: { id: string } }>('/api/workspaces/:id/sessions', async (req, reply) => {
    const ws = await deps.store.get(req.params.id);
    if (!ws) return reply.code(404).send({ message: '工作区不存在' });
    const sessions = await api.list(ws.localDir);
    return sessions.map((s) => ({ sessionId: s.sessionId, summary: s.summary, lastModified: s.lastModified }));
  });

  app.get<{ Params: { id: string; sessionId: string } }>('/api/workspaces/:id/sessions/:sessionId/events', async (req, reply) => {
    if (!SESSION_ID.test(req.params.sessionId)) return reply.code(400).send({ message: '会话 id 不合法' });
    const ws = await deps.store.get(req.params.id);
    if (!ws) return reply.code(404).send({ message: '工作区不存在' });
    const mapper = new ClaudeEventMapper();
    const messages = await api.messages(req.params.sessionId, ws.localDir);
    return messages.flatMap((m) => mapper.mapHistory(m));
  });
}
