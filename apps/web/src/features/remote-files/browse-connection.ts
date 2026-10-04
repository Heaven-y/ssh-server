import type { RemoteBrowseSession, RemoteBrowseTarget } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';

type Requests = Pick<typeof api, 'bindRemoteBrowseTarget' | 'createRemoteBrowseSession' | 'closeRemoteBrowseSession'>;
type Binding = { binding: string } | { error: ApiError };

/** 管理单个面板的目标与连接资源；React 重挂载/重连不能重新绑定目标。 */
export function createBrowseConnection(workspaceId: string, target: RemoteBrowseTarget, requests: Requests = api) {
  const snapshot = { ...target };
  let identity: Promise<Binding> | undefined;
  let session: RemoteBrowseSession | undefined;
  let opening: AbortController | undefined;
  let generation = 0;
  const close = (current: RemoteBrowseSession | undefined) => {
    if (current) void requests.closeRemoteBrowseSession(workspaceId, current.id).catch(() => undefined);
  };
  const bind = () => {
    identity ??= requests.bindRemoteBrowseTarget(workspaceId, snapshot).catch((error: unknown) => {
      const reason = error instanceof ApiError ? error.message : '无法联系本机服务';
      return {
        error: new ApiError(409, `无法绑定服务器目标：${reason}。请关闭并重新打开文件面板。`, {
          code: 'binding_failed',
        }),
      };
    });
    return identity;
  };
  const assertCurrent = (signal: AbortSignal, attempt: number) => {
    signal.throwIfAborted();
    if (attempt !== generation) throw new DOMException('目录连接请求已被替换', 'AbortError');
  };
  return {
    bind,
    async connect(signal: AbortSignal) {
      const attempt = ++generation;
      opening?.abort();
      signal.throwIfAborted();
      const controller = new AbortController();
      opening = controller;
      const cancelled = AbortSignal.any([signal, controller.signal]);
      const bound = await bind();
      assertCurrent(cancelled, attempt);
      if ('error' in bound) throw bound.error;
      if (session) return session;
      // 请求取消传到后端；若传输层仍返回迟到 ID，再显式关闭该资源。
      const created = await requests.createRemoteBrowseSession(workspaceId, snapshot, bound.binding, cancelled);
      try {
        assertCurrent(cancelled, attempt);
      } catch (error) {
        close(created);
        throw error;
      }
      session = created;
      return created;
    },
    release() {
      generation++;
      opening?.abort();
      opening = undefined;
      close(session);
      session = undefined;
    },
  };
}
