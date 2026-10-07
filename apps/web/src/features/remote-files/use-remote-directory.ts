import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteBrowseSession, RemoteBrowseTarget, RemoteDirectory, Workspace } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';
import { createBrowseConnection } from './browse-connection';

type DirectoryRequest = { id: number; path: string; cursor?: string; page: number };
type DirectoryResult = { requestId: number; directory?: RemoteDirectory; page: number };
type DirectoryFailure = { requestId: number; message: string; code?: string };

function failureOf(error: unknown, requestId: number): DirectoryFailure {
  if (error instanceof ApiError) return { requestId, message: error.message, code: error.code };
  return { requestId, message: '无法读取服务器目录，请检查本机服务或 SSH 连接后重试。' };
}

/** 仅保存当前页；浏览请求不经过本地文件、同步或正文读取接口。 */
export function useRemoteDirectory(workspace: Workspace, active: boolean) {
  const [binding] = useState(() => ({
    workspaceId: workspace.id,
    target: {
      sshHost: workspace.sshHost,
      remoteDir: workspace.remoteDir,
      localDir: workspace.localDir,
    } satisfies RemoteBrowseTarget,
  }));
  const [connection] = useState(() => createBrowseConnection(binding.workspaceId, binding.target));
  const [enabled, setEnabled] = useState(active);
  const [request, setRequest] = useState<DirectoryRequest>({ id: 0, path: '', page: 1 });
  const [session, setSession] = useState<RemoteBrowseSession>();
  const [result, setResult] = useState<DirectoryResult>({ requestId: -1, page: 1 });
  const [failure, setFailure] = useState<DirectoryFailure>();
  const readController = useRef<AbortController | undefined>(undefined);

  // 激活一次后保持挂载；隐藏不重连、不轮询，也不丢弃当前路径。
  if (active && !enabled) setEnabled(true);

  useEffect(() => {
    // 打开面板即绑定实际身份；此接口不连接 SSH。StrictMode 重挂载复用同一个 Promise。
    void connection.bind();
    return () => {
      readController.current?.abort();
      connection.release();
    };
  }, [connection]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    readController.current = controller;
    const load = async () => {
      try {
        const connected = await connection.connect(controller.signal);
        if (controller.signal.aborted) return;
        setSession(connected);
        const directory = await api.listRemoteFiles(binding.workspaceId, connected.id, request, controller.signal);
        if (!controller.signal.aborted) setResult({ requestId: request.id, directory, page: request.page });
      } catch (error) {
        if (!controller.signal.aborted) setFailure(failureOf(error, request.id));
      }
    };
    void load();
    return () => controller.abort();
  }, [binding, connection, enabled, request]);

  const error = failure?.requestId === request.id ? failure : undefined;
  const loading = enabled && result.requestId !== request.id && !error;
  const navigate = (path: string, cursor?: string, page = 1) => {
    readController.current?.abort();
    setRequest((previous) => ({ id: previous.id + 1, path, cursor, page }));
  };
  const reconnect = () => {
    readController.current?.abort();
    connection.release();
    setSession(undefined);
    navigate(request.path);
  };
  const retry = () => navigate(request.path, request.cursor, request.page);
  const refresh = () => navigate(result.directory?.path ?? request.path);
  const nextPage = () => {
    const directory = result.directory;
    if (directory?.nextCursor) navigate(directory.path, directory.nextCursor, result.page + 1);
  };
  const createSecondarySession = useCallback(
    async (signal: AbortSignal) => {
      const identity = await connection.bind();
      signal.throwIfAborted();
      if ('error' in identity) throw identity.error;
      const created = await api.createRemoteBrowseSession(
        binding.workspaceId,
        binding.target,
        identity.binding,
        signal,
      );
      if (signal.aborted) {
        void api.closeRemoteBrowseSession(binding.workspaceId, created.id).catch(() => undefined);
        signal.throwIfAborted();
      }
      return created;
    },
    [binding, connection],
  );
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
    createSecondarySession,
  };
}
