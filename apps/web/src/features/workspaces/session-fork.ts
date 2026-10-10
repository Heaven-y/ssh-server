import { NativeSessionIdSchema, type SessionForkInput, type SessionRef } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { queryClient } from '../../lib/query-client';
import { managementPending, sessionActionKey, useChat, type SessionOperation } from '../chat/chat-store';

type Current = ReturnType<typeof useChat.getState>;
function isSource(current: Current, workspaceId: string, session: SessionRef): boolean {
  return (
    current.workspaceId === workspaceId && current.agent === session.agent && current.sessionId === session.sessionId
  );
}
function setOperation(key: string, operation?: SessionOperation): void {
  useChat.setState((current) => {
    const sessionOperations = { ...current.sessionOperations };
    if (operation) sessionOperations[key] = operation;
    else delete sessionOperations[key];
    return { sessionOperations };
  });
}
function checkResult(source: SessionRef, result: SessionRef): void {
  if (
    result.agent !== source.agent ||
    result.sessionId === source.sessionId ||
    !NativeSessionIdSchema.safeParse(result.sessionId).success
  )
    throw new Error('分叉响应的会话身份不匹配，请重新读取原生列表核对');
}
function canSelect(current: Current, workspaceId: string, version: number): boolean {
  return (
    current.workspaceId === workspaceId &&
    current.conversationVersion === version &&
    !current.running &&
    !current.pendingClientTurnId &&
    !managementPending(current)
  );
}

/** 原生请求发出后不随弹窗关闭撤销；全局跟踪源身份，迟到成功不能覆盖新选择。 */
export async function forkSession(workspaceId: string, session: SessionRef, input: SessionForkInput): Promise<boolean> {
  const key = sessionActionKey(workspaceId, session);
  const current = useChat.getState();
  if (current.sessionOperations[key]?.pending) return false;
  if (isSource(current, workspaceId, session) && current.running) {
    setOperation(key, { action: 'fork', pending: false, error: '请结束源会话后再分叉' });
    return false;
  }
  setOperation(key, { action: 'fork', pending: true });
  try {
    const result = await api.sessionFork(workspaceId, session.sessionId, session.agent, input);
    checkResult(session, result.session);
    setOperation(key);
    if (canSelect(useChat.getState(), workspaceId, current.conversationVersion))
      await useChat.getState().openSession(result.session);
    return true;
  } catch (error) {
    setOperation(key, {
      action: 'fork',
      pending: false,
      error: error instanceof Error ? error.message : '分叉结果未确认，请重新读取原生列表核对',
    });
    return false;
  } finally {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions(workspaceId, session.agent) });
  }
}
