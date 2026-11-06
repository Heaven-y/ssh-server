import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Workspace } from '@agentdeck/shared/projects';
import { lastWorkspaceId, managementPending, sessionActionKey, useChat } from '../features/chat/chat-store';
import { parseSessionLink } from '../features/sessions/session-links';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
const currentHash = () => window.location.hash;
function restoreProject(projects: Workspace[]): void {
  const current = useChat.getState();
  if (projects.some((project) => project.id === current.workspaceId)) return;
  const last = lastWorkspaceId();
  current.selectWorkspace(projects.find((project) => project.id === last)?.id ?? projects[0]?.id);
}
function followLink(hash: string, projects: Workspace[]): void {
  try {
    const target = parseSessionLink(hash);
    if (!target) return;
    if (!projects.some((project) => project.id === target.workspaceId)) throw new Error('链接中的项目不存在或已移除');
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

/**
 * 项目导航：首次恢复上次项目、跟随会话深链接。
 * 迟到的一次性项目列表不能重放用户已放弃的初始链接，所以只处理 hash 变化。
 */
export function useProjectNavigation(projects?: Workspace[]): void {
  const workspaceId = useChat((state) => state.workspaceId);
  const hash = useSyncExternalStore(subscribe, currentHash, () => '');
  const handled = useRef<string | undefined>(undefined);
  const initialVersion = useRef(useChat.getState().conversationVersion);
  useEffect(() => {
    if (!projects) return;
    const first = handled.current === undefined;
    const changed = first && useChat.getState().conversationVersion !== initialVersion.current;
    const navigate = handled.current !== hash && !changed;
    handled.current = hash;
    restoreProject(projects);
    if (navigate) followLink(hash, projects);
  }, [projects, workspaceId, hash]);
}
