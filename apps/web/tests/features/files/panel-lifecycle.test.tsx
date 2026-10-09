// @vitest-environment jsdom
import { EditorView } from '@uiw/react-codemirror';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileEditorMessage, FileEditorServerMessage } from '@ssh-server/shared';
import FilesPanel from '../../../src/features/files/FilesPanel';
import { api } from '../../../src/lib/api';
import { workspace } from '../resources/fixtures';

class EditorSocket {
  static OPEN = 1;
  static instances: EditorSocket[] = [];
  readyState = 1;
  onmessage?: (event: MessageEvent<string>) => void;
  onclose?: () => void;
  onerror?: () => void;
  sent: FileEditorMessage[] = [];
  constructor(readonly url: URL) {
    EditorSocket.instances.push(this);
    queueMicrotask(() => this.receive({ type: 'ready' }));
  }
  send(source: string) {
    this.sent.push(JSON.parse(source));
  }
  receive(message: FileEditorServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  EditorSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', EditorSocket);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(api, 'listFiles').mockResolvedValue({ path: '', entries: [], truncated: false });
  vi.spyOn(api, 'readFile').mockResolvedValue({
    path: 'main.py',
    content: 'print(1)\n',
    revision: 'revision-a',
    size: 9,
  });
  vi.spyOn(api, 'fileRevision').mockResolvedValue({ revision: 'revision-a' });
  vi.spyOn(api, 'disconnectedEditors').mockResolvedValue({ editors: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});
async function tick(ms = 30) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function panel(active: boolean, close: () => void, current = workspace) {
  return (
    <QueryClientProvider client={client}>
      <FilesPanel workspace={current} active={active} onClose={close} />
    </QueryClientProvider>
  );
}
async function openAndEdit() {
  await tick();
  fireEvent.change(screen.getByRole('textbox', { name: '相对路径' }), { target: { value: 'main.py' } });
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  await tick();
  const editor = EditorView.findFromDOM(screen.getByRole('textbox', { name: '项目文件内容' }))!;
  act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'print("未保存")\n' } }));
  return editor;
}
it('隐藏不卸载编辑器/登记或迁移固定工作区，关闭仍要求放弃确认', async () => {
  const close = vi.fn();
  const view = render(panel(true, close));
  const editor = await openAndEdit();
  const socket = EditorSocket.instances[0]!;
  expect(socket.sent.at(-1)).toMatchObject({ type: 'state', state: { dirty: true, path: 'main.py' } });
  view.rerender(panel(false, close, { ...workspace, id: 'w2', name: '另一项目' }));
  await tick();
  expect(screen.queryByRole('textbox', { name: '项目文件内容' })).toBeNull();
  expect(socket.readyState).toBe(1);
  expect(socket.sent.some((message) => message.type === 'release')).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
  view.rerender(panel(true, close, { ...workspace, id: 'w2', name: '另一项目' }));
  await tick();
  expect(EditorView.findFromDOM(screen.getByRole('textbox', { name: '项目文件内容' }))).toBe(editor);
  expect(editor.state.doc.toString()).toBe('print("未保存")\n');
  expect(screen.getByText('工作区：示例项目')).toBeTruthy();
  expect(api.readFile).toHaveBeenCalledWith('w1', 'main.py', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: '关闭文件面板' }));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭文件面板' }));
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(socket.sent.at(-1)).toEqual({ type: 'release' });
  expect(socket.readyState).toBe(3);
});
it('隐藏停止文件修订与断开登记查询，保留实时锁定通道；恢复后继续原修订检查', async () => {
  const view = render(panel(true, vi.fn()));
  await openAndEdit();
  await tick(5100);
  const revisions = vi.mocked(api.fileRevision).mock.calls.length;
  const disconnected = vi.mocked(api.disconnectedEditors).mock.calls.length;
  view.rerender(panel(false, vi.fn()));
  await tick(16_000);
  expect(api.fileRevision).toHaveBeenCalledTimes(revisions);
  expect(api.disconnectedEditors).toHaveBeenCalledTimes(disconnected);
  const socket = EditorSocket.instances[0]!;
  const token = crypto.randomUUID();
  act(() => socket.receive({ type: 'reserve', token }));
  expect(socket.sent.at(-1)).toMatchObject({ type: 'reserved', token, state: { dirty: true, path: 'main.py' } });
  act(() => socket.receive({ type: 'unlock', token }));
  view.rerender(panel(true, vi.fn()));
  await tick(5100);
  expect(api.fileRevision).toHaveBeenCalledTimes(revisions + 1);
  expect(EditorSocket.instances).toHaveLength(1);
});
it('隐藏的文件区不提前读取本地目录', async () => {
  const view = render(panel(false, vi.fn()));
  await tick();
  expect(api.listFiles).not.toHaveBeenCalled();
  view.rerender(panel(true, vi.fn()));
  await tick();
  expect(api.listFiles).toHaveBeenCalledTimes(1);
});
