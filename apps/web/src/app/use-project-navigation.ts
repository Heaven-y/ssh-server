import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Workspace } from '@agentdeck/shared/projects';
import { lastWorkspaceId, sessionActionKey, useChat } from '../features/chat/chat-store';
import { navigateToSessionReference, parseSessionLink, SESSION_OPEN_EVENT } from '../features/sessions/session-links';
import { parseSessionReference, sessionReferenceHash } from '@agentdeck/shared/conversation';

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}
const currentHash = () => window.location.hash;
type SessionLinkBridge = NonNullable<NonNullable<Window['agentDeck']>['sessionLinks']>;
// StrictMode 会重新挂载 effect；初始引用只能在仍挂载的订阅者接收后消费。
const initialReferences = new WeakMap<SessionLinkBridge, { request: Promise<string | undefined>; handled: boolean }>();
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
    if (targetPending) throw new Error('目标会话正在管理，请稍后再打开链接');
    current.selectWorkspace(target.workspaceId, { restore: false });
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
    const open = (event: Event) => {
      if (projects && event instanceof CustomEvent && typeof event.detail === 'string')
        followLink(event.detail, projects);
    };
    window.addEventListener(SESSION_OPEN_EVENT, open);
    return () => window.removeEventListener(SESSION_OPEN_EVENT, open);
  }, [projects]);
  useEffect(() => {
    const bridge = window.agentDeck?.sessionLinks;
    if (!bridge) return;
    let active = true;
    let received = false;
    const unsubscribe = bridge.onOpen((reference) => {
      received = true;
      navigateToSessionReference(reference);
    });
    let initial = initialReferences.get(bridge);
    if (!initial) {
      initial = { request: bridge.initial(), handled: false };
      initialReferences.set(bridge, initial);
    }
    const pending = initial;
    void pending.request
      .then((reference) => {
        if (!active || pending.handled) return;
        pending.handled = true;
        if (received || !reference) return;
        const target = sessionReferenceHash(parseSessionReference(reference));
        if (window.location.hash !== target) navigateToSessionReference(reference);
      })
      .catch(() => {
        if (active) useChat.setState({ banner: '无法打开桌面会话链接，请重新点击链接' });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
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
