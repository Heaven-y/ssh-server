// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type ProductSettingsDocument } from '@ssh-server/shared';
import { api, ApiError, queryKeys } from '../../../src/lib/api';
import { queryClient } from '../../../src/lib/query-client';
import { useProductSettings } from '../../../src/features/settings/use-product-settings';
import ProductSettingsDialog from '../../../src/features/settings/ProductSettingsDialog';

const document: ProductSettingsDocument = { settings: ProductSettingsSchema.parse({}), revision: 'missing' };
const saved: ProductSettingsDocument = {
  settings: ProductSettingsSchema.parse({ syncIntervalSeconds: 5 }),
  revision: 'a'.repeat(64),
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.restoreAllMocks();
});

it('仍可见的窗口返回焦点时共享重读一次；卸载后移除监听', async () => {
  const read = vi.spyOn(api, 'readProductSettings').mockResolvedValue(document);
  const hook = renderHook(
    () => {
      useProductSettings();
      return useProductSettings();
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  hook.unmount();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(read).toHaveBeenCalledTimes(2);
});

it('保存发布新设置前取消旧共享GET，迟到响应不能回退偏好', async () => {
  const stale = deferred<ProductSettingsDocument>();
  const read = vi.spyOn(api, 'readProductSettings').mockReturnValueOnce(stale.promise).mockResolvedValue(document);
  renderHook(() => useProductSettings(), { wrapper });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  vi.spyOn(api, 'saveProductSettings').mockResolvedValue(saved);
  render(<ProductSettingsDialog onClose={vi.fn()} onNative={vi.fn()} />, { wrapper });
  fireEvent.click(screen.getByRole('tab', { name: '文件同步' }));
  const input = await screen.findByLabelText(/自动同步间隔/);
  fireEvent.change(input, { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('产品设置已保存到本机。');
  await act(async () => {
    stale.resolve(document);
  });
  expect(queryClient.getQueryData(queryKeys.productSettings)).toEqual(saved);
});

it('四类设置只显示当前内容，跨类草稿统一保存且默认作用域清楚', async () => {
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(document);
  const save = vi
    .spyOn(api, 'saveProductSettings')
    .mockImplementation(async ({ settings }) => ({ settings, revision: 'b'.repeat(64) }));
  const readEnvironment = vi.spyOn(api, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
  const detect = vi.spyOn(api, 'detectEnvironment').mockResolvedValue({ checkedAt: 2, tools: [] });
  render(<ProductSettingsDialog onClose={vi.fn()} onNative={vi.fn()} />, { wrapper });
  const model = await screen.findByLabelText(/Claude 默认模型/);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tabpanel', { name: '对话与模型' })).toBeTruthy();
  expect(screen.queryByLabelText(/自动同步间隔/)).toBeNull();
  expect(screen.queryByRole('button', { name: '重新检测' })).toBeNull();
  expect(readEnvironment).not.toHaveBeenCalled();
  fireEvent.change(model, { target: { value: 'demo-model' } });
  fireEvent.click(screen.getByRole('tab', { name: '文件同步' }));
  expect(screen.queryByLabelText(/Claude 默认模型/)).toBeNull();
  expect(screen.getByText(/已有工作区.*同步面板/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/默认单文件上限/), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('tab', { name: '服务器资源' }));
  fireEvent.change(screen.getByLabelText(/资源检查间隔/), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('tab', { name: '运行环境' }));
  expect(screen.queryByLabelText(/资源检查间隔/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('tab', { name: '对话与模型' }));
  expect(screen.getByLabelText<HTMLInputElement>(/Claude 默认模型/).value).toBe('demo-model');
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('产品设置已保存到本机。');
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]![0]).toMatchObject({
    revision: 'missing',
    settings: {
      defaultModels: { claude: 'demo-model' },
      syncDefaults: { maxFileBytes: 8388608 },
      resources: { intervalSeconds: 4 },
    },
  });
});

it('其他分类存在无效草稿时保存定位回错误字段，不丢弃跨类修改', async () => {
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(document);
  const save = vi.spyOn(api, 'saveProductSettings');
  render(<ProductSettingsDialog onClose={vi.fn()} onNative={vi.fn()} />, { wrapper });
  await screen.findByLabelText(/Claude 默认模型/);
  fireEvent.click(screen.getByRole('tab', { name: '文件同步' }));
  fireEvent.change(screen.getByLabelText(/自动同步间隔/), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('tab', { name: '服务器资源' }));
  fireEvent.change(screen.getByLabelText(/资源检查间隔/), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('tabpanel', { name: '文件同步' })).toBeTruthy();
  const invalid = screen.getByLabelText(/自动同步间隔/);
  expect(invalid.getAttribute('aria-invalid')).toBe('true');
  await waitFor(() => expect(globalThis.document.activeElement).toBe(invalid));
  fireEvent.click(screen.getByRole('tab', { name: '服务器资源' }));
  expect(screen.getByLabelText<HTMLInputElement>(/资源检查间隔/).value).toBe('6');
});

it('跨分类保存冲突保留草稿，关闭、原生视图、重读与Esc均保留未保存保护', async () => {
  const read = vi.spyOn(api, 'readProductSettings').mockResolvedValue(document);
  vi.spyOn(api, 'saveProductSettings').mockRejectedValue(new ApiError(409, '产品设置已变化，请重新读取'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const close = vi.fn();
  const native = vi.fn();
  render(<ProductSettingsDialog onClose={close} onNative={native} />, { wrapper });
  fireEvent.change(await screen.findByLabelText(/Claude 默认模型/), { target: { value: 'local-draft' } });
  fireEvent.click(screen.getByRole('tab', { name: '服务器资源' }));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑原生 Agent 配置' }));
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(confirm).toHaveBeenCalledTimes(4);
  expect(close).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('tab', { name: '对话与模型' }));
  expect(screen.getByLabelText<HTMLInputElement>(/Claude 默认模型/).value).toBe('local-draft');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/Claude 默认模型/).value).toBe(''));
});
