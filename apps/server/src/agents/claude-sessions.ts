import { getSessionInfo, getSessionMessages, listSessions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { SessionError, type SessionProvider } from '../chat/sessions';
import { ClaudeEventMapper } from './claude-mapper';
import { sameSessionDirectory } from './session-scope';

export type ClaudeSessionsApi = {
  list(dir: string): Promise<SDKSessionInfo[]>;
  info(id: string, dir: string): Promise<SDKSessionInfo | undefined>;
  messages(id: string, dir: string): Promise<unknown[]>;
};

const nativeApi: ClaudeSessionsApi = {
  list: (dir) => listSessions({ dir, includeWorktrees: false }),
  info: (id, dir) => getSessionInfo(id, { dir }),
  messages: (id, dir) => getSessionMessages(id, { dir, includeSystemMessages: true }),
};

function lastModel(messages: unknown[]): string | undefined {
  for (const value of messages.toReversed()) {
    if (!value || typeof value !== 'object' || !('message' in value)) continue;
    const message = value.message;
    if (message && typeof message === 'object' && 'model' in message && typeof message.model === 'string')
      return message.model;
  }
  return undefined;
}

export function createClaudeSessions(api: ClaudeSessionsApi = nativeApi): SessionProvider {
  async function info(id: string, dir: string): Promise<SDKSessionInfo> {
    const record = await api.info(id, dir);
    // 老会话可能没有 cwd；SDK 带 dir 的读取仍限定原生项目存储位置。
    if (!record || record.sessionId !== id || (record.cwd && !(await sameSessionDirectory(record.cwd, dir))))
      throw new SessionError(404, 'session_missing', 'Claude Code 在当前工作区中没有此会话');
    return record;
  }
  return {
    async list(dir) {
      const records = await api.list(dir);
      const scoped = await Promise.all(
        records.map(async (record) => !record.cwd || (await sameSessionDirectory(record.cwd, dir))),
      );
      return records
        .filter((_, index) => scoped[index])
        .map(({ sessionId, summary, lastModified }) => ({ sessionId, summary, lastModified }));
    },
    async read(id, dir) {
      const record = await info(id, dir);
      const messages = await api.messages(id, dir);
      const mapper = new ClaudeEventMapper();
      return {
        session: { sessionId: record.sessionId, summary: record.summary, lastModified: record.lastModified },
        cwd: record.cwd ?? dir,
        actualModel: lastModel(messages),
        events: messages.flatMap((message) => mapper.mapHistory(message)),
      };
    },
    async assertBelongs(id, dir) {
      await info(id, dir);
    },
  };
}
