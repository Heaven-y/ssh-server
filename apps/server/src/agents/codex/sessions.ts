import { NativeSessionIdSchema, type SessionActionInput, type SessionForkInput } from '@ssh-server/shared';
import { sameSessionDirectory } from '../session-scope';
import type { NativeSessionFork, NativeSessionRead, NativeSessionSummary } from '../types';
import { SessionError } from '../../chat/sessions';
import { CodexClient } from './client';
import { CodexEventMapper, codexForkPoint } from './mapper';
import { cancelled, CodexError, record, text, type CodexRuntimeOptions, type RecordValue } from './types';

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
    ...(text(thread.model).trim() ? { nativeModel: text(thread.model).trim() } : {}),
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
  options: CodexRuntimeOptions & { archived?: boolean } = {},
): Promise<NativeSessionSummary[]> {
  const archived = options.archived ?? false;
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
        archived,
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

function internalSubagent(thread: RecordValue): boolean {
  return !!(thread.parentThreadId || record(thread.source).subAgent || text(thread.source).startsWith('subAgent'));
}

async function mutableThread(client: CodexClient, id: string, dir: string, includeTurns = false): Promise<RecordValue> {
  const thread = record((await client.request('thread/read', { threadId: id, includeTurns })).thread);
  if (thread.id !== id || !(await sameSessionDirectory(text(thread.cwd), dir)))
    throw new SessionError(404, 'session_missing', 'Codex 在当前工作区中没有此会话');
  if (record(thread.status).type === 'active')
    throw new SessionError(409, 'session_busy', 'Codex 会话正在运行，请结束后再管理');
  if (internalSubagent(thread)) throw new SessionError(400, 'unsupported_action', '不能单独管理 Codex 内部子代理会话');
  return thread;
}

/** 原生请求发送后继续等结果；停止等待并不代表撤销重命名、归档或删除。 */
export async function mutateCodexSession(
  id: string,
  dir: string,
  input: SessionActionInput,
  options: CodexRuntimeOptions = {},
): Promise<void> {
  if (options.signal?.aborted) throw cancelled();
  await withClient(dir, { ...options, signal: undefined }, async (client) => {
    await mutableThread(client, id, dir);
    if (options.signal?.aborted) throw cancelled();
    const methods = {
      rename: 'thread/name/set',
      delete: 'thread/delete',
      archive: 'thread/archive',
      unarchive: 'thread/unarchive',
    };
    await client.request(methods[input.action], {
      threadId: id,
      ...(input.action === 'rename' ? { name: input.title } : {}),
    });
  });
}

async function forkedThread(thread: RecordValue, sourceId: string, dir: string): Promise<NativeSessionFork> {
  const id = NativeSessionIdSchema.safeParse(thread.id);
  if (!id.success || id.data === sourceId || internalSubagent(thread))
    throw new SessionError(503, 'session_runtime_failed', 'Codex 分叉返回了无效的新会话');
  if (
    !(await sameSessionDirectory(text(thread.cwd), dir)) ||
    (thread.forkedFromId != null && thread.forkedFromId !== sourceId)
  )
    throw new SessionError(503, 'session_runtime_failed', 'Codex 分叉返回了无效的新会话');
  return { session: summary(thread), cwd: text(thread.cwd) };
}

/** 原生 inclusive 分叉不改源会话；请求发出后不因 HTTP/调用方断开而提前释放。 */
export async function forkCodexSession(
  id: string,
  dir: string,
  input: SessionForkInput,
  options: CodexRuntimeOptions = {},
): Promise<NativeSessionFork> {
  if (options.signal?.aborted) throw cancelled();
  return withClient(dir, { ...options, signal: undefined }, async (client) => {
    // 先核验元数据，避免读取跨目录或内部子代理的完整历史。
    await mutableThread(client, id, dir);
    const turns = completeTurns(await mutableThread(client, id, dir, true));
    if (turns.some((turn) => turn.status === 'inProgress'))
      throw new SessionError(409, 'session_busy', 'Codex 会话尚有未结束的轮次，请结束后再分叉');
    if (input.pointId !== undefined && !turns.some((turn) => codexForkPoint(turn) === input.pointId))
      throw new SessionError(400, 'invalid_fork_point', '分叉点不属于当前会话或尚未结束，请刷新历史后重试');
    if (options.signal?.aborted) throw cancelled();
    const response = await client.request('thread/fork', {
      threadId: id,
      ...(input.pointId ? { lastTurnId: input.pointId } : {}),
    });
    return forkedThread(record(response.thread), id, dir);
  });
}
