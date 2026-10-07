import {
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  renameSession,
  type SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk';
import { SessionError, type SessionProvider } from '../chat/sessions';
import { ClaudeEventMapper } from './claude-mapper';
import { sameSessionDirectory } from './session-scope';

export type ClaudeSessionsApi = {
  list(dir: string): Promise<SDKSessionInfo[]>;
  info(id: string, dir: string): Promise<SDKSessionInfo | undefined>;
  messages(id: string, dir: string): Promise<unknown[]>;
  rename(id: string, title: string, dir: string): Promise<void>;
  delete(id: string, dir: string): Promise<void>;
};

const nativeApi: ClaudeSessionsApi = {
  list: (dir) => listSessions({ dir, includeWorktrees: false }),
  info: (id, dir) => getSessionInfo(id, { dir }),
  messages: (id, dir) => getSessionMessages(id, { dir, includeSystemMessages: true }),
  rename: (id, title, dir) => renameSession(id, title, { dir }),
  delete: (id, dir) => deleteSession(id, { dir }),
};

function modelValue(message: object): string | undefined {
  const model = 'model' in message && typeof message.model === 'string' ? message.model.trim() : '';
  return model && model !== '<synthetic>' ? model : undefined;
}
function assistantModel(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'assistant') return;
  if ('parent_tool_use_id' in value && value.parent_tool_use_id) return;
  if (!('message' in value) || !value.message || typeof value.message !== 'object') return;
  return modelValue(value.message);
}
function lastModel(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const model = assistantModel(messages[index]);
    if (model) return model;
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
    async list(dir, _signal, archived = false) {
      if (archived) throw new SessionError(400, 'unsupported_action', 'Claude Code 不支持归档会话');
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
    async mutate(id, dir, input) {
      if (input.action === 'archive' || input.action === 'unarchive')
        throw new SessionError(400, 'unsupported_action', 'Claude Code 不支持归档会话');
      const record = await info(id, dir);
      // 管理操作不采用老会话的目录缺失回退，避免 SDK 搜索关联工作树后修改错误的记录。
      if (!record.cwd) throw new SessionError(404, 'session_missing', 'Claude Code 会话缺少工作区信息，无法修改');
      if (input.action === 'rename') return api.rename(id, input.title, dir);
      return api.delete(id, dir);
    },
  };
}
