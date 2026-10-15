import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceFile } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : '无法读取文件内容，请检查本机服务后重试。';

/**
 * 本地文件只读预览：只保存最近一次读取结果，不保留编辑缓冲、dirty 状态或写入通道。
 * 外部程序改动文件后由用户显式“重新读取”，不自动覆盖正在显示的内容。
 */
export function useFilePreview(workspaceId: string) {
  const [file, setFile] = useState<WorkspaceFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);

  const open = useCallback(
    async (relative: string) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setBusy(true);
      setError('');
      try {
        const current = await api.readFile(workspaceId, relative, controller.signal);
        if (controller.signal.aborted || !alive.current) return;
        setFile(current);
      } catch (failure) {
        if (!controller.signal.aborted && alive.current) setError(messageOf(failure));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [workspaceId],
  );

  return { file, busy, error, open };
}
