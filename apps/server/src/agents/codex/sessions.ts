import { sameSessionDirectory } from '../session-scope';
import type { NativeSessionRead, NativeSessionSummary } from '../types';
import { CodexClient } from './client';
import { CodexEventMapper } from './mapper';
import { CodexError, record, text, type CodexRuntimeOptions, type RecordValue } from './types';

const MAX_SESSIONS = 100_000;
function completeTurns(thread: RecordValue): RecordValue[] {
  if (!Array.isArray(thread.turns)) throw new CodexError('Codex 未返回完整的会话历史。');
  return thread.turns.map((value) => {
    const turn = record(value);
    if (!Array.isArray(turn.items) || (turn.itemsView !== undefined && turn.itemsView !== 'full')) {
      throw new CodexError('Codex 返回的历史尚未完整加载，无法展示完整会话。');
    }
    return turn;
  });
}
function summary(thread: RecordValue): NativeSessionSummary {
  return {
    sessionId: text(thread.id),
    summary: text(thread.name) || text(thread.preview) || 'Codex 会话',
    lastModified: typeof thread.updatedAt === 'number' ? thread.updatedAt * 1_000 : 0,
  };
}

export async function checkedThread(
  client: CodexClient,
  id: string,
  dir: string,
  includeTurns = false,
): Promise<RecordValue> {
  const response = await client.request('thread/read', { threadId: id, includeTurns });
  const thread = record(response.thread);
  if (thread.id !== id || !(await sameSessionDirectory(text(thread.cwd), dir))) {
    throw new CodexError('Codex 会话不属于当前工作区，无法读取或续接。');
  }
  return thread;
}

async function withClient<T>(
  dir: string,
  options: CodexRuntimeOptions,
  action: (client: CodexClient) => Promise<T>,
): Promise<T> {
  const client = await CodexClient.start({ ...options, cwd: dir });
  try {
    await client.initialize();
    return await action(client);
  } finally {
    await client.close();
  }
}

export async function assertCodexSession(id: string, dir: string, options: CodexRuntimeOptions = {}): Promise<void> {
  await withClient(dir, options, async (client) => {
    await checkedThread(client, id, dir);
  });
}

export async function readCodexSession(
  id: string,
  dir: string,
  options: CodexRuntimeOptions = {},
): Promise<NativeSessionRead> {
  return withClient(dir, options, async (client) => {
    await checkedThread(client, id, dir);
    const thread = await checkedThread(client, id, dir, true);
    const mapper = new CodexEventMapper();
    return {
      session: summary(thread),
      cwd: text(thread.cwd),
      events: completeTurns(thread).flatMap((turn) => mapper.history(turn)),
      ...(text(thread.model) ? { actualModel: text(thread.model) } : {}),
    };
  });
}

async function matchingSummaries(data: unknown[], dir: string): Promise<NativeSessionSummary[]> {
  const result: NativeSessionSummary[] = [];
  for (const value of data) {
    const thread = record(value);
    if (thread.parentThreadId || typeof thread.source === 'object') continue;
    if (text(thread.id) && (await sameSessionDirectory(text(thread.cwd), dir))) result.push(summary(thread));
  }
  return result;
}

export async function listCodexSessions(
  dir: string,
  options: CodexRuntimeOptions = {},
): Promise<NativeSessionSummary[]> {
  return withClient(dir, options, async (client) => {
    const sessions = new Map<string, NativeSessionSummary>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let count = 0;
    do {
      const response = await client.request('thread/list', {
        cwd: dir,
        limit: 100,
        sortKey: 'updated_at',
        modelProviders: [],
        sourceKinds: ['cli', 'vscode', 'exec', 'appServer'],
        cursor,
      });
      if (!Array.isArray(response.data)) throw new CodexError('Codex 未返回有效的会话列表。');
      const data = response.data;
      count += data.length;
      if (count > MAX_SESSIONS || cursors.size >= 1_000)
        throw new CodexError('Codex 会话数量超过读取上限，无法返回完整列表。');
      for (const session of await matchingSummaries(data, dir)) sessions.set(session.sessionId, session);
      cursor = text(response.nextCursor) || undefined;
      if (cursor && cursors.has(cursor)) throw new CodexError('Codex 会话分页异常，无法返回完整列表。');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...sessions.values()].sort((left, right) => right.lastModified - left.lastModified);
  });
}
