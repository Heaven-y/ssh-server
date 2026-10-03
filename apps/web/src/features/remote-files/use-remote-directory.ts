import { useEffect, useRef, useState } from 'react';
import type { RemoteBrowseSession, RemoteBrowseTarget, RemoteDirectory, Workspace } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';

type DirectoryRequest = { id: number; path: string; cursor?: string; page: number };
type DirectoryResult = { requestId: number; directory?: RemoteDirectory; page: number };
type DirectoryFailure = { requestId: number; message: string; code?: string };

function failureOf(error: unknown, requestId: number): DirectoryFailure {
  if (error instanceof ApiError) return { requestId, message: error.message, code: error.code };
  return { requestId, message: '无法读取服务器目录，请检查本机服务或 SSH 连接后重试。' };
}

function bindTarget(workspaceId: string, target: RemoteBrowseTarget) {
  // 连失败结果也缓存，读取或重连不能在用户不知情时绑定到变化后的目标。
  return api.bindRemoteBrowseTarget(workspaceId, target).catch((error: unknown) => {
    const reason = error instanceof ApiError ? error.message : '无法联系本机服务';
    return {
      error: new ApiError(409, `无法绑定服务器目标：${reason}。请关闭并重新打开文件面板。`, { code: 'binding_failed' }),
    };
  });
}

function closeSession(workspaceId: string, session: RemoteBrowseSession | undefined) {
  if (session) {
    // 关闭失败时由后端闲置超时兜底；卸载后的结果不能再修改面板。
    void api.closeRemoteBrowseSession(workspaceId, session.id).catch(() => undefined);
  }
}

/** 仅保存当前页；浏览请求不经过本地文件、同步或正文读取接口。 */
export function useRemoteDirectory(workspace: Workspace, active: boolean) {
  const [binding] = useState(() => ({
    workspaceId: workspace.id,
    target: {
      sshHost: workspace.sshHost,
      authMode: workspace.authMode,
      remoteDir: workspace.remoteDir,
      localDir: workspace.localDir,
    } satisfies RemoteBrowseTarget,
  }));
  const [enabled, setEnabled] = useState(active);
  const [request, setRequest] = useState<DirectoryRequest>({ id: 0, path: '', page: 1 });
  const [session, setSession] = useState<RemoteBrowseSession>();
  const [result, setResult] = useState<DirectoryResult>({ requestId: -1, page: 1 });
  const [failure, setFailure] = useState<DirectoryFailure>();
  const currentSession = useRef<RemoteBrowseSession | undefined>(undefined);
  const readController = useRef<AbortController | undefined>(undefined);
  const targetBinding = useRef<ReturnType<typeof bindTarget> | undefined>(undefined);

  // 激活一次后保持挂载；隐藏不重连、不轮询，也不丢弃当前路径。
  if (active && !enabled) setEnabled(true);

  useEffect(() => {
    // 打开面板即绑定实际身份；此接口不连接 SSH。StrictMode 重挂载复用同一个 Promise。
    targetBinding.current ??= bindTarget(binding.workspaceId, binding.target);
    return () => {
      readController.current?.abort();
      closeSession(binding.workspaceId, currentSession.current);
      currentSession.current = undefined;
    };
  }, [binding]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    readController.current = controller;
    const load = async () => {
      try {
        let connected = currentSession.current;
        if (!connected) {
          const identity = await targetBinding.current;
          if (!identity || controller.signal.aborted) return;
          if ('error' in identity) throw identity.error;
          // 不取消创建请求：收到迟到的 ID 后显式关闭，避免 StrictMode 或卸载泄漏会话。
          connected = await api.createRemoteBrowseSession(binding.workspaceId, binding.target, identity.binding);
          if (controller.signal.aborted) {
            closeSession(binding.workspaceId, connected);
            return;
          }
          currentSession.current = connected;
          setSession(connected);
        }
        const directory = await api.listRemoteFiles(binding.workspaceId, connected.id, request, controller.signal);
        if (!controller.signal.aborted) setResult({ requestId: request.id, directory, page: request.page });
      } catch (error) {
        if (!controller.signal.aborted) setFailure(failureOf(error, request.id));
      }
    };
    void load();
    return () => controller.abort();
  }, [binding, enabled, request]);

  const error = failure?.requestId === request.id ? failure : undefined;
  const loading = enabled && result.requestId !== request.id && !error;
  const navigate = (path: string, cursor?: string, page = 1) => {
    readController.current?.abort();
    setRequest((previous) => ({ id: previous.id + 1, path, cursor, page }));
  };
  const reconnect = () => {
    readController.current?.abort();
    closeSession(binding.workspaceId, currentSession.current);
    currentSession.current = undefined;
    setSession(undefined);
    navigate(request.path);
  };
  const retry = () => navigate(request.path, request.cursor, request.page);
  const refresh = () => navigate(result.directory?.path ?? request.path);
  const nextPage = () => {
    const directory = result.directory;
    if (directory?.nextCursor) navigate(directory.path, directory.nextCursor, result.page + 1);
  };
  return {
    session,
    directory: result.directory,
    page: result.page,
    loading,
    error,
    navigate,
    retry,
    refresh,
    reconnect,
    nextPage,
  };
}
