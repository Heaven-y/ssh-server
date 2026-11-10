import { useEffect, useRef, useState } from 'react';
import type { SshConsoleDirectory, SshConsolePreview } from '@agentdeck/shared/ssh';
import { sshConsoleApi } from './api';
import { consoleError } from './console-state';
import { commitDirectory, type DirectoryHistory, type NavigationKind } from './file-navigation';

export function useConsoleFiles(serverId: string, initialDirectory: string, active: boolean) {
  const [request, setRequest] = useState<{ path: string; kind: NavigationKind }>({
    path: initialDirectory,
    kind: 'push',
  });
  const [directory, setDirectory] = useState<SshConsoleDirectory>();
  const [history, setHistory] = useState<DirectoryHistory>({ entries: [], index: -1 });
  const [preview, setPreview] = useState<SshConsolePreview>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  const previewPending = useRef<AbortController | undefined>(undefined);
  const lastRequest = useRef<typeof request | undefined>(undefined);
  const listedPath = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    pending.current = controller;
    const returning = lastRequest.current === request && listedPath.current !== undefined;
    const path = returning ? listedPath.current! : request.path;
    lastRequest.current = request;
    void sshConsoleApi
      .directory(serverId, path, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setDirectory(value);
        listedPath.current = value.path;
        setHistory((current) => commitDirectory(current, value.path, returning ? 'refresh' : request.kind));
        setError('');
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(consoleError(reason));
        setLoading(false);
      });
    return () => controller.abort();
  }, [serverId, request, active]);
  useEffect(() => () => previewPending.current?.abort(), []);
  useEffect(() => {
    if (!active) previewPending.current?.abort();
  }, [active]);
  const closePreview = () => {
    previewPending.current?.abort();
    setPreview(undefined);
    setPreviewLoading(false);
  };
  const navigate = (path: string, kind: NavigationKind = 'push') => {
    pending.current?.abort();
    closePreview();
    setError('');
    setLoading(true);
    setRequest({ path, kind });
  };
  const open = async (file: string) => {
    closePreview();
    const controller = new AbortController();
    previewPending.current = controller;
    setPreviewLoading(true);
    setError('');
    try {
      const value = await sshConsoleApi.preview(serverId, file, controller.signal);
      if (!controller.signal.aborted) setPreview(value);
    } catch (reason) {
      if (!controller.signal.aborted) setError(consoleError(reason));
    } finally {
      if (previewPending.current === controller) setPreviewLoading(false);
    }
  };
  const step = (delta: number) => {
    const index = history.index + delta;
    const path = history.entries[index];
    if (path !== undefined) navigate(path, index);
  };
  return {
    directory,
    preview,
    error,
    loading,
    previewLoading,
    navigate,
    open,
    closePreview,
    step,
    path: directory?.path ?? initialDirectory,
    canBack: history.index > 0,
    canForward: history.index >= 0 && history.index < history.entries.length - 1,
  };
}
export type ConsoleFileBrowser = ReturnType<typeof useConsoleFiles>;
