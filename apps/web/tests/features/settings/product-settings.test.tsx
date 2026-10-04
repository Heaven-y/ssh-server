// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type ProductSettingsDocument } from '@ssh-server/shared';
import { api, queryKeys } from '../../../src/lib/api';
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
  const input = await screen.findByLabelText(/自动同步间隔/);
  fireEvent.change(input, { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('产品设置已保存到本机。');
  await act(async () => {
    stale.resolve(document);
  });
  expect(queryClient.getQueryData(queryKeys.productSettings)).toEqual(saved);
});
