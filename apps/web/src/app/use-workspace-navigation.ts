import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Workspace } from '@ssh-server/shared';
import { lastWorkspaceId, managementPending, sessionActionKey, useChat } from '../features/chat/chat-store';
import { parseSessionLink } from '../features/workspaces/session-links';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
const currentHash = () => window.location.hash;
function restoreWorkspace(workspaces: Workspace[]): void {
  const current = useChat.getState();
  if (workspaces.some((workspace) => workspace.id === current.workspaceId)) return;
  const last = lastWorkspaceId();
  current.selectWorkspace(workspaces.find((workspace) => workspace.id === last)?.id ?? workspaces[0]?.id);
}
function followLink(hash: string, workspaces: Workspace[]): void {
  try {
    const target = parseSessionLink(hash);
    if (!target) return;
    if (!workspaces.some((workspace) => workspace.id === target.workspaceId))
      throw new Error('链接中的工作区不存在或已移除');
    const current = useChat.getState();
    const targetPending = current.sessionOperations[sessionActionKey(target.workspaceId, target)]?.pending;
    if (current.running || current.pendingClientTurnId || managementPending(current) || targetPending)
      throw new Error('请结束当前会话操作后再打开链接');
    current.selectWorkspace(target.workspaceId);
    // openSession 自身校验选择代次，后续选择会取消本次历史请求。
    void useChat.getState().openSession(target);
  } catch (error) {
    useChat.setState({ banner: error instanceof Error ? error.message : '无法打开会话链接' });
  }
}

/** 首次恢复与 hash 导航共用入口；迟到的工作区列表不能重放用户已放弃的初始链接。 */
export function useWorkspaceNavigation(workspaces?: Workspace[]): void {
  const workspaceId = useChat((state) => state.workspaceId);
  const hash = useSyncExternalStore(subscribe, currentHash, () => '');
  const handled = useRef<string | undefined>(undefined);
  const initialVersion = useRef(useChat.getState().conversationVersion);
  useEffect(() => {
    if (!workspaces) return;
    const first = handled.current === undefined;
    const changed = first && useChat.getState().conversationVersion !== initialVersion.current;
    const navigate = handled.current !== hash && !changed;
    handled.current = hash;
    restoreWorkspace(workspaces);
    if (navigate) followLink(hash, workspaces);
  }, [workspaces, workspaceId, hash]);
}
