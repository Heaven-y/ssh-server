// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type SyncStatus } from '@ssh-server/shared';
import { SyncPanel } from '../../../src/features/sync/SyncPanel';
import { api, queryKeys } from '../../../src/lib/api';

const workspace = {
  id: 'w1',
  name: '示例项目',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
  localDir: 'project',
};
const initial: SyncStatus = {
  phase: 'confirmation_required',
  reason: 'initialization',
  deletions: [],
  conflicts: [],
  settings: { maxFileBytes: 3 * 1024 ** 2, excludedExtensions: ['pt'] },
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(api, 'readProductSettings').mockResolvedValue({
    settings: ProductSettingsSchema.parse({ syncDefaults: { maxFileBytes: 9 * 1024 ** 2 } }),
    revision: 'missing',
  });
  vi.spyOn(api, 'syncStatus').mockResolvedValue(initial);
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.restoreAllMocks();
});
function mount() {
  render(
    <QueryClientProvider client={client}>
      <SyncPanel workspace={workspace} />
    </QueryClientProvider>,
  );
}
it('从同步入口可直接发现当前工作区规则，修改只写当前工作区且重建仍需确认', async () => {
  const update = vi
    .spyOn(api, 'updateSyncSettings')
    .mockImplementation(async (_id, settings) => ({ ...initial, reason: 'filter_changed', settings }));
  const initialize = vi.spyOn(api, 'initializeSync').mockResolvedValue({ ...initial, phase: 'ready' });
  const globalSave = vi.spyOn(api, 'saveProductSettings');
  mount();
  fireEvent.click(screen.getByRole('button', { name: '文件同步详情' }));
  const form = await screen.findByRole('form', { name: '当前工作区同步规则' });
  expect(form.closest('details')?.open).toBe(true);
  expect(screen.getByText(/仅影响当前工作区/)).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>('单文件上限（MiB）').value).toBe('3');
  await client.invalidateQueries({ queryKey: queryKeys.productSettings });
  expect(screen.getByLabelText<HTMLInputElement>('单文件上限（MiB）').value).toBe('3');
  fireEvent.change(screen.getByLabelText('单文件上限（MiB）'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '保存当前工作区规则' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('w1', { maxFileBytes: 4194304, excludedExtensions: ['pt'] }));
  expect(globalSave).not.toHaveBeenCalled();
  const rebuild = await screen.findByRole<HTMLButtonElement>('button', { name: '确认初始化或恢复' });
  expect(rebuild.disabled).toBe(true);
  expect(initialize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对两端目录/ }));
  fireEvent.click(rebuild);
  await waitFor(() => expect(initialize).toHaveBeenCalledWith('w1'));
});
it('删除待确认仍展示两种明确决策，打开规则不确认删除或初始化', async () => {
  vi.spyOn(api, 'syncStatus').mockResolvedValue({ ...initial, reason: 'deletions', deletions: ['demo.txt'] });
  const decide = vi.spyOn(api, 'decideSyncDeletions').mockResolvedValue(initial);
  const initialize = vi.spyOn(api, 'initializeSync');
  mount();
  fireEvent.click(screen.getByRole('button', { name: '文件同步详情' }));
  await screen.findByRole('form', { name: '当前工作区同步规则' });
  expect(screen.getByText('demo.txt')).toBeTruthy();
  expect(screen.getByRole('button', { name: '恢复本地文件' })).toBeTruthy();
  expect(decide).not.toHaveBeenCalled();
  expect(initialize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认同步删除' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith('w1', 'confirm'));
});
