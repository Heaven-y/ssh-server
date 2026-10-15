// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FilesPanel from '../../../src/features/files/FilesPanel';
import { api } from '../../../src/lib/api';
import { workspace } from '../resources/fixtures';

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  HTMLDialogElement.prototype.show = HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(api, 'listFiles').mockResolvedValue({
    path: '',
    entries: [{ path: 'main.py', name: 'main.py', kind: 'file', size: 9 }],
    truncated: false,
  });
  vi.spyOn(api, 'readFile').mockResolvedValue({ path: 'main.py', content: 'print(1)\n', size: 9 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
async function openFile() {
  await tick();
  fireEvent.doubleClick(screen.getByRole('button', { name: 'main.py' }));
  await tick();
}

it('隐藏不卸载预览也不迁移固定工作区，关闭无需确认', async () => {
  const close = vi.fn();
  const view = render(panel(true, close));
  await openFile();
  expect(screen.getByRole('textbox', { name: '项目文件内容' })).toBeTruthy();
  view.rerender(panel(false, close, { ...workspace, id: 'w2', name: '另一项目' }));
  await tick();
  expect(screen.queryByRole('textbox', { name: '项目文件内容' })).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
  view.rerender(panel(true, close, { ...workspace, id: 'w2', name: '另一项目' }));
  await tick();
  expect(screen.getByRole('textbox', { name: '项目文件内容' })).toBeTruthy();
  expect(screen.getByText('工作区：示例项目')).toBeTruthy();
  expect(api.readFile).toHaveBeenCalledWith('w1', 'main.py', expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: '关闭文件面板' }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(window.confirm).not.toHaveBeenCalled();
});

it('只读预览不发起修订轮询与编辑器登记查询，隐藏后不重复读取', async () => {
  const view = render(panel(true, vi.fn()));
  await openFile();
  await tick(16_000);
  const reads = vi.mocked(api.readFile).mock.calls.length;
  expect(reads).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: '重新读取文件' }));
  await tick();
  expect(api.readFile).toHaveBeenCalledTimes(reads + 1);
  view.rerender(panel(false, vi.fn()));
  await tick(16_000);
  expect(api.readFile).toHaveBeenCalledTimes(reads + 1);
});

it('隐藏的文件区不提前读取本地目录，面板内不再有按路径打开表单', async () => {
  const view = render(panel(false, vi.fn()));
  await tick();
  expect(api.listFiles).not.toHaveBeenCalled();
  view.rerender(panel(true, vi.fn()));
  await tick();
  expect(api.listFiles).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('textbox', { name: '相对路径' })).toBeNull();
});
