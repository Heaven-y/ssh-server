// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type SyncStatus } from '@ssh-server/shared';
import { api, queryKeys } from '../../../src/lib/api';
import { useWorkspaceSync } from '../../../src/features/sync/use-workspace-sync';

const ready: SyncStatus = {
  phase: 'ready',
  deletions: [],
  conflicts: [],
  settings: { maxFileBytes: 3 * 1024 ** 2, excludedExtensions: ['pt'] },
};
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, 'syncStatus').mockResolvedValue(ready);
  vi.spyOn(api, 'syncWorkspace').mockResolvedValue(ready);
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('设置读取中显示一分钟回退，不抢先传输', async () => {
  vi.spyOn(api, 'readProductSettings').mockReturnValue(new Promise(() => undefined));
  const hook = renderHook(() => useWorkspaceSync('w1'), { wrapper });
  expect(hook.result.current.intervalSeconds).toBe(60);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(api.syncWorkspace).not.toHaveBeenCalled();
});

it('保存15到60后旧调度销毁，状态查询仍为3秒，手动同步不等待定时器', async () => {
  const previous = { settings: ProductSettingsSchema.parse({ syncIntervalSeconds: 15 }), revision: 'a'.repeat(64) };
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(previous);
  client.setQueryData(queryKeys.productSettings, previous);
  client.setQueryData(queryKeys.sync('w1'), ready);
  const hook = renderHook(() => useWorkspaceSync('w1'), { wrapper });
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(api.syncWorkspace).toHaveBeenCalledTimes(1);
  await act(async () => {
    client.setQueryData(queryKeys.productSettings, {
      settings: { ...previous.settings, syncIntervalSeconds: 60 },
      revision: 'b'.repeat(64),
    });
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(hook.result.current.intervalSeconds).toBe(60);
  await act(async () => vi.advanceTimersByTimeAsync(59000));
  expect(api.syncWorkspace).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(api.syncWorkspace).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.syncStatus).mock.calls.length).toBeGreaterThanOrEqual(20);
  await act(async () => hook.result.current.perform('sync'));
  expect(api.syncWorkspace).toHaveBeenCalledTimes(3);
});
