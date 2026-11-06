// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useSessionPages } from '../../../src/features/sessions/use-session-pages';
import { sessionsApi } from '../../../src/features/sessions/api';
import { invalidateSessionPages } from '../../../src/features/sessions/session-queries';
import { ApiError } from '../../../src/lib/http';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const row = (id: string) => ({
  agent: 'codex' as const,
  sessionId: id,
  title: id,
  projectId: 'demo',
  running: false,
  updatedAt: '2026-11-06T00:00:00Z',
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(({ search }) => useSessionPages({ search }), {
    initialProps: { search: '' },
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...hook, client };
}
it('首屏每来源一次，继续加载不重取首屏，搜索旧记录与操作后重读各自完整', async () => {
  const read = vi.spyOn(sessionsApi, 'page').mockImplementation(async ({ agent, cursor, search }) => {
    if (agent !== 'codex') return { items: [] };
    if (search) return { items: [row('未加载旧会话')] };
    return cursor ? { items: [row('下一页')] } : { items: [row('最近会话')], nextCursor: 'next' };
  });
  const f = mount();
  await waitFor(() => expect(f.result.current.loading).toBe(false));
  expect(read).toHaveBeenCalledTimes(3);
  act(() => f.result.current.more());
  await waitFor(() => expect(f.result.current.sessions).toHaveLength(2));
  expect(read).toHaveBeenCalledTimes(4);
  await act(() => invalidateSessionPages(f.client, { queryKey: ['sessions'] }));
  await waitFor(() => expect(f.result.current.sessions.map((item) => item.title)).toEqual(['最近会话']));
  expect(read).toHaveBeenCalledTimes(7);
  f.rerender({ search: '旧会话' });
  await waitFor(() => expect(f.result.current.sessions[0]?.title).toBe('未加载旧会话'));
  f.client.clear();
});
it('旧游标失效从首屏恢复，不保留已经删除的前页结果', async () => {
  let changed = false;
  vi.spyOn(sessionsApi, 'page').mockImplementation(async ({ agent, cursor }) => {
    if (agent !== 'codex') return { items: [] };
    if (cursor) {
      changed = true;
      throw new ApiError(409, '列表变化', { code: 'session_page_expired' });
    }
    return { items: [row(changed ? '新列表' : '已删除')], nextCursor: changed ? undefined : 'old' };
  });
  const f = mount();
  await waitFor(() => expect(f.result.current.sessions[0]?.title).toBe('已删除'));
  act(() => f.result.current.more());
  await waitFor(() => expect(f.result.current.sessions.map((item) => item.title)).toEqual(['新列表']));
  f.client.clear();
});
