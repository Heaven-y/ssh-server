import { randomUUID } from 'node:crypto';
import type { FileEditorMessage, FileEditorServerMessage, FileEditorState } from '@ssh-server/shared';
import type { PreparedAction } from '../remote-files/preflight';
import { RemoteFilesError } from '../remote-files/errors';
import { createEditorRecords } from './editor-records';

export type EditorPeer = { send(message: FileEditorServerMessage): void };
type Pending = { token: string; resolve(): void; reject(error: unknown): void };
type Editor = { id: string; workspaceId: string; peer?: EditorPeer; state?: FileEditorState; pending?: Pending };

export function createFileEditors(configDir: string) {
  const storage = createEditorRecords(configDir);
  const editors = new Map<string, Editor>();
  const reservations = new Map<string, string>();
  const ready = storage.read().then((records) => {
    for (const record of records) editors.set(record.id, record);
  });
  void ready.catch(() => undefined);
  const records = (except?: string) =>
    [...editors.values()].filter((editor) => editor.id !== except).map(({ id, workspaceId }) => ({ id, workspaceId }));
  let membership: Promise<unknown> = ready;
  function change<T>(operation: () => Promise<T>): Promise<T> {
    const run = membership.then(operation, operation);
    membership = run.catch(() => undefined);
    return run;
  }

  async function attach(id: string, workspaceId: string, peer: EditorPeer) {
    await ready;
    return change(async () => {
      if (reservations.has(workspaceId)) throw new RemoteFilesError('editor_locked');
      const existing = editors.get(id);
      if (existing && (existing.peer || existing.workspaceId !== workspaceId))
        throw new RemoteFilesError('editor_unavailable');
      if (!existing && editors.size >= 64) throw new RemoteFilesError('too_many_tasks');
      const editor: Editor = { id, workspaceId, peer };
      editors.set(id, editor);
      await storage.save(records());
      // 登记持久化后才能允许客户端编辑。
      peer.send({ type: 'ready' });
    });
  }
  function detach(id: string, peer: EditorPeer) {
    const editor = editors.get(id);
    if (editor?.peer !== peer) return;
    editor.peer = undefined;
    editor.pending?.reject(new RemoteFilesError('editor_unavailable'));
    editor.pending = undefined;
  }
  async function receive(id: string, peer: EditorPeer, message: FileEditorMessage) {
    const editor = editors.get(id);
    if (editor?.peer !== peer) throw new RemoteFilesError('editor_unavailable');
    if (message.type === 'release') {
      return change(async () => {
        if (reservations.has(editor.workspaceId)) throw new RemoteFilesError('editor_locked');
        // 显式关闭表示缓冲已保存或用户已确认放弃；删除失败仍保留登记。
        await storage.save(records(id));
        editors.delete(id);
      });
    }
    editor.state = message.state;
    if (message.type !== 'reserved' || editor.pending?.token !== message.token) return;
    if (message.state.dirty || message.state.busy) editor.pending.reject(new RemoteFilesError('editor_dirty'));
    else editor.pending.resolve();
  }
  function handshake(editor: Editor, token: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const abort = () => editor.pending?.reject(signal.reason);
      const timer = setTimeout(() => editor.pending?.reject(new RemoteFilesError('editor_unavailable')), 5000);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        editor.pending = undefined;
      };
      editor.pending = {
        token,
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error instanceof Error ? error : new RemoteFilesError('editor_unavailable'));
        },
      };
      // 清理覆盖超时和取消；失败后由 reserve 统一解锁所有参与者。
      signal.addEventListener('abort', abort, { once: true });
      try {
        editor.peer!.send({ type: 'reserve', token });
      } catch (error) {
        editor.pending.reject(error);
      }
    });
  }
  async function reserve(action: PreparedAction, signal: AbortSignal) {
    await ready;
    await membership;
    signal.throwIfAborted();
    const ids = action.public.affectedWorkspaces.map((workspace) => workspace.id);
    if (ids.some((id) => reservations.has(id))) throw new RemoteFilesError('editor_locked');
    const token = randomUUID();
    for (const id of ids) reservations.set(id, token);
    const participating = [...editors.values()].filter((editor) => ids.includes(editor.workspaceId));
    const release = () => {
      for (const id of ids) if (reservations.get(id) === token) reservations.delete(id);
      for (const editor of participating) {
        editor.pending?.reject(new RemoteFilesError('editor_unavailable'));
        editor.peer?.send({ type: 'unlock', token });
      }
    };
    try {
      if (participating.some((editor) => !editor.peer || !editor.state))
        throw new RemoteFilesError('editor_unavailable');
      await Promise.all(participating.map((editor) => handshake(editor, token, signal)));
      signal.throwIfAborted();
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }
  return {
    attach,
    detach,
    receive,
    reserve,
    async disconnected(workspaceId: string) {
      await ready;
      return [...editors.values()].filter((item) => item.workspaceId === workspaceId && !item.peer).map(({ id }) => id);
    },
    async forget(workspaceId: string, id: string) {
      await ready;
      return change(async () => {
        const editor = editors.get(id);
        if (!editor || editor.workspaceId !== workspaceId || editor.peer || reservations.has(workspaceId))
          throw new RemoteFilesError('editor_unavailable');
        await storage.save(records(id));
        editors.delete(id);
      });
    },
  };
}
export type FileEditors = ReturnType<typeof createFileEditors>;
