import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SyncStatus, WorkspaceFile } from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../lib/api';
import { createEditorConnection, type EditorConnection } from './editor-connection';

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : '文件操作失败，请检查本机服务后重试。';

async function synchronize(id: string, local: WorkspaceFile, received: (status: SyncStatus) => void) {
  const sync = await api.syncWorkspace(id);
  received(sync);
  const current = await api.fileRevision(id, local.path);
  if (current.revision !== local.revision)
    return {
      message: '本地保存已完成；当前文件已变化。',
      error: '',
      external: '同步期间文件又发生修改；本次编辑内容已保留，请重新读取核对。',
    };
  if (sync.phase === 'ready' && !sync.reason && !sync.conflicts.length && !sync.deletions.length)
    return { message: '本地已保存，服务器已同步。', external: '', error: '' };
  return {
    message: '本地已保存，服务器尚未同步。',
    external: '',
    error: sync.message ?? '同步有待处理事项，请查看工作区同步面板。',
  };
}

function useFileRevision(
  id: string,
  file: WorkspaceFile | undefined,
  enabled: boolean,
  changed: (text: string) => void,
) {
  useEffect(() => {
    if (!file || !enabled) return;
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const latest = await api.fileRevision(id, file.path, controller.signal);
        if (!controller.signal.aborted)
          changed(
            latest.revision === file.revision
              ? ''
              : '文件已被其他程序或同步修改；当前编辑内容已保留，请核对后重新读取。',
          );
      } catch (error) {
        if (!controller.signal.aborted) changed(messageOf(error));
      } finally {
        checking = false;
      }
    };
    const visible = () => {
      void check();
    };
    const timer = window.setInterval(visible, 5000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [id, file, enabled, changed]);
}

export function useFileEditor(workspaceId: string) {
  const client = useQueryClient();
  const [file, setFile] = useState<WorkspaceFile>();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState<'loading' | 'saving'>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [external, setExternal] = useState('');
  const [protection, setProtection] = useState('正在登记编辑保护…');
  const guard = useRef<EditorConnection | null>(null);
  const request = useRef<AbortController | null>(null);
  const working = useRef(false);
  const alive = useRef(true);
  const dirty = !!file && content !== file.content;
  const publish = (current: WorkspaceFile | undefined, dirty: boolean, busy: boolean) =>
    guard.current?.update({ path: current?.path ?? null, dirty, busy });

  useEffect(() => {
    alive.current = true;
    const connection = createEditorConnection(workspaceId, setProtection);
    guard.current = connection;
    return () => {
      alive.current = false;
      request.current?.abort();
      connection.dispose();
      guard.current = null;
    };
  }, [workspaceId]);
  useEffect(() => {
    if (!dirty && busy !== 'saving') return;
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [dirty, busy]);
  useFileRevision(workspaceId, file, !busy, setExternal);

  const edit = useCallback(
    (value: string) => {
      if (!guard.current?.canEdit()) return;
      guard.current.update({ path: file?.path ?? null, dirty: !!file && value !== file.content, busy: false });
      setContent(value);
      setMessage('');
      setError('');
    },
    [file],
  );
  const canLeave = () =>
    !working.current &&
    !guard.current?.isReserved() &&
    (!dirty || window.confirm('文件有未保存修改。取消可返回保存；确定将放弃修改。'));
  const canClose = () => {
    if (!canLeave()) return false;
    guard.current?.approveClose();
    return true;
  };
  const open = async (relative: string) => {
    if (!guard.current?.canEdit() || !canLeave()) return;
    working.current = true;
    publish(file, dirty, true);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy('loading');
    setError('');
    setMessage('');
    try {
      const current = await api.readFile(workspaceId, relative, controller.signal);
      if (controller.signal.aborted) return;
      setFile(current);
      setContent(current.content);
      setExternal('');
      publish(current, false, false);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(messageOf(failure));
        publish(file, dirty, false);
      }
    } finally {
      working.current = false;
      if (alive.current) setBusy(undefined);
    }
  };
  const canSave = () => !!file && !working.current && dirty && guard.current?.canEdit();
  const save = async () => {
    if (!file || !canSave()) return;
    working.current = true;
    publish(file, dirty, true);
    setBusy('saving');
    setError('');
    setMessage('正在保存到本地…');
    let saved = false;
    try {
      const local = await api.saveFile(workspaceId, { path: file.path, content, revision: file.revision });
      saved = true;
      publish(local, false, true);
      if (alive.current) {
        setFile(local);
        setContent(local.content);
        setExternal('');
        setMessage('本地已保存，正在同步到服务器…');
      }
      const result = await synchronize(workspaceId, local, (sync) =>
        client.setQueryData(queryKeys.sync(workspaceId), sync),
      );
      if (alive.current) {
        setMessage(result.message);
        setError(result.error);
        setExternal(result.external);
      }
    } catch (failure) {
      if (alive.current) {
        setMessage(saved ? '本地已保存，服务器同步尚未确认。' : '');
        setError(messageOf(failure));
      }
    } finally {
      working.current = false;
      publish(file, !saved && dirty, false);
      if (alive.current) setBusy(undefined);
    }
  };
  return { file, content, dirty, busy, message, error, external, protection, edit, open, save, canClose };
}
