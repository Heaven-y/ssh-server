// @vitest-environment jsdom
import { ApiError } from '../../../src/lib/http';
import { settingsApi, settingsKeys } from '../../../src/features/settings/api';
import { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type ProductSettingsDocument } from '@agentdeck/shared/settings';

import { queryClient } from '../../../src/lib/query-client';
import { useProductSettings } from '../../../src/features/settings/use-product-settings';
import ProductSettingsDialog from '../../../src/features/settings/ProductSettingsDialog';
import { parseSettingsDraft } from '../../../src/features/settings/product-settings-draft';
import { ProductSettingsForm } from '../../../src/features/settings/ProductSettingsForm';

const document: ProductSettingsDocument = { settings: ProductSettingsSchema.parse({}), revision: 'missing' };
const saved: ProductSettingsDocument = {
  settings: ProductSettingsSchema.parse({ resources: { intervalSeconds: 20, timeoutSeconds: 8 } }),
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
  const read = vi.spyOn(settingsApi, 'readProductSettings').mockResolvedValue(document);
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
  const read = vi
    .spyOn(settingsApi, 'readProductSettings')
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValue(document);
  renderHook(() => useProductSettings(), { wrapper });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  vi.spyOn(settingsApi, 'saveProductSettings').mockResolvedValue(saved);
  render(<ProductSettingsDialog initialPage="general" onClose={vi.fn()} onNative={vi.fn()} />, { wrapper });
  fireEvent.change(await screen.findByLabelText('默认 Agent'), { target: { value: 'codex' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('产品设置已保存到本机。');
  await act(async () => {
    stale.resolve(document);
  });
  expect(queryClient.getQueryData(settingsKeys.productSettings)).toEqual(saved);
});

it('设置侧栏按用途分类，通用偏好保存后可查看本机环境', async () => {
  vi.spyOn(settingsApi, 'readProductSettings').mockResolvedValue(document);
  const save = vi
    .spyOn(settingsApi, 'saveProductSettings')
    .mockImplementation(async ({ settings }) => ({ settings, revision: 'b'.repeat(64) }));
  const readEnvironment = vi.spyOn(settingsApi, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
  const detect = vi.spyOn(settingsApi, 'detectEnvironment').mockResolvedValue({ checkedAt: 2, tools: [] });
  render(<ProductSettingsDialog initialPage="general" onClose={vi.fn()} onNative={vi.fn()} />, { wrapper });
  const agent = await screen.findByLabelText('默认 Agent');
  const navigation = screen.getByRole('navigation', { name: '设置分类' });
  expect(within(navigation).getAllByRole('button')).toHaveLength(3);
  expect(within(navigation).getByRole('button', { name: '模型与连接' })).toBeTruthy();
  expect(screen.queryByLabelText(/资源检查间隔/)).toBeNull();
  expect(readEnvironment).not.toHaveBeenCalled();
  fireEvent.change(agent, { target: { value: 'codex' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('产品设置已保存到本机。');
  expect(save.mock.calls[0]![0]).toMatchObject({
    revision: 'missing',
    settings: { defaultAgent: 'codex', resources: { intervalSeconds: 5 } },
  });
  expect(save.mock.calls[0]![0].settings).not.toHaveProperty('defaultModels');
  fireEvent.click(screen.getByRole('button', { name: '运行环境' }));
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
});

it('跨分类保存冲突保留草稿，关闭、原生视图、重读与Esc均保留未保存保护', async () => {
  const read = vi.spyOn(settingsApi, 'readProductSettings').mockResolvedValue(document);
  vi.spyOn(settingsApi, 'saveProductSettings').mockRejectedValue(new ApiError(409, '产品设置已变化，请重新读取'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const close = vi.fn();
  const native = vi.fn();
  render(<ProductSettingsDialog initialPage="general" onClose={close} onNative={native} />, { wrapper });
  fireEvent.change(await screen.findByLabelText('默认 Agent'), { target: { value: 'codex' } });
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
  fireEvent.click(screen.getByRole('button', { name: '模型与连接' }));
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(confirm).toHaveBeenCalledTimes(4);
  expect(close).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText<HTMLSelectElement>('默认 Agent').value).toBe('codex');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('默认 Agent').value).toBe('claude'));
});

it('修改默认CLI保留原有服务器参数，设置中不再暴露采样选项', async () => {
  const existing = {
    ...document,
    settings: { ...document.settings, resources: { intervalSeconds: 30, timeoutSeconds: 9 } },
  };
  vi.spyOn(settingsApi, 'readProductSettings').mockResolvedValue(existing);
  const save = vi
    .spyOn(settingsApi, 'saveProductSettings')
    .mockImplementation(async ({ settings }) => ({ settings, revision: 'c'.repeat(64) }));
  render(<ProductSettingsDialog initialPage="general" onClose={vi.fn()} onNative={vi.fn()} />, { wrapper });
  fireEvent.change(await screen.findByLabelText('默认 Agent'), { target: { value: 'codex' } });
  expect(screen.queryByRole('tab', { name: '服务器资源' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('产品设置已保存到本机。');
  expect(save.mock.calls[0]![0].settings.resources).toEqual(existing.settings.resources);
});

const productDraft = {
  defaultAgent: 'codex' as const,
  resourceInterval: '7',
  resourceTimeout: '9',
};

it('产品草稿保存只输出现行偏好，不包含同步分类字段与已退休模型字段', () => {
  const result = parseSettingsDraft(productDraft);
  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data).toMatchObject({
    defaultAgent: 'codex',
    resources: { intervalSeconds: 7, timeoutSeconds: 9 },
  });
  expect(result.data).not.toHaveProperty('defaultModels');
});

it('对话分类保留默认Agent，不再提供网页默认模型输入', () => {
  const change = vi.fn();
  render(<ProductSettingsForm draft={productDraft} disabled={false} change={change} />);
  expect(screen.getByLabelText<HTMLSelectElement>('默认 Agent').value).toBe('codex');
  expect(screen.getByRole('option', { name: 'Antigravity' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('默认 Agent'), { target: { value: 'antigravity' } });
  expect(change).toHaveBeenCalledWith({ defaultAgent: 'antigravity' });
  expect(screen.queryByLabelText(/Claude 默认模型/)).toBeNull();
  expect(screen.queryByLabelText(/Codex 默认模型/)).toBeNull();
});
