import { ApiError } from '../../lib/http';
import { sessionsApi, sessionsKeys } from './api';
// 会话数据的查询层：项目会话列表与单条原生历史都用 react-query 缓存，
// 历史读取的失败按错误码分类，界面据此区分「不可回放」「会话不存在」与「读取出错」。
import { useQuery } from '@tanstack/react-query';
import type { AgentKind, SessionHistory, SessionRef } from '@agentdeck/shared/conversation';

import type { SessionHistoryFailure } from './SessionTimeline';

/** 项目会话列表：与左栏、对话区共用同一个缓存键，切项目不重复取。 */
export function sessionListQuery(projectId: string, agent: AgentKind) {
  return {
    queryKey: sessionsKeys.sessions(projectId, agent),
    queryFn: ({ signal }: { signal: AbortSignal }) => sessionsApi.listSessions(projectId, agent, false, signal),
    retry: false as const,
  };
}

/** 单条历史：只有选中会话后才请求，切换会话时取消上一次读取。 */
export function useSessionHistory(
  projectId: string | undefined,
  session: SessionRef | undefined,
): {
  history: SessionHistory | undefined;
  failure: SessionHistoryFailure | undefined;
  notReplayable: boolean;
  loading: boolean;
  retry(): void;
} {
  const query = useQuery({
    queryKey: sessionsKeys.sessionHistory(projectId ?? '', session?.agent ?? 'claude', session?.sessionId ?? ''),
    queryFn: ({ signal }) => readHistory(projectId, session, signal),
    enabled: !!projectId && !!session,
    retry: false,
  });
  const failure = query.error ? sessionHistoryFailure(query.error) : undefined;
  return {
    history: query.data,
    failure,
    notReplayable: failure?.kind === 'not-replayable',
    loading: query.isLoading,
    retry: () => void query.refetch(),
  };
}

function readHistory(projectId: string | undefined, session: SessionRef | undefined, signal: AbortSignal) {
  if (!projectId || !session) throw new Error('尚未选择会话');
  return sessionsApi.sessionEvents(projectId, session.sessionId, session.agent, signal);
}

/**
 * 错误码是唯一可靠的分流依据：Antigravity 的 read() 固定返回 501 + session_not_replayable，
 * 不能把这条能力边界降级成普通的「加载失败」。
 */
export function sessionHistoryFailure(error: unknown): SessionHistoryFailure {
  if (error instanceof ApiError) {
    if (error.code === 'session_not_replayable') return { kind: 'not-replayable', message: error.message };
    if (error.code === 'session_missing' || error.status === 404)
      return { kind: 'missing', message: error.message || '这个会话不存在，或已不在当前项目目录中。' };
    if (error.status === 401) return { kind: 'failed', message: error.message };
    return { kind: 'failed', message: error.message || `原生会话读取失败（${error.status}）` };
  }
  // fetch 只在网络层失败时抛 TypeError；HTTP 错误一律是 ApiError。
  if (error instanceof TypeError)
    return { kind: 'network', message: '无法连接本机服务，请确认 AgentDeck 后端仍在运行后重试。' };
  if (error instanceof Error) return { kind: 'failed', message: error.message };
  return { kind: 'failed', message: '原生会话读取失败，请重试。' };
}
