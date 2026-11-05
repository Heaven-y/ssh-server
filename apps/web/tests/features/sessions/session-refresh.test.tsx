// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../src/lib/api';
import { SessionRefreshControl } from '../../../src/features/sessions/SessionRefreshControl';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <SessionRefreshControl />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

it('首次只建立版本基线；版本变化才刷新会话列表，不刷新能力或重读当前正文', async () => {
  const changes = vi.spyOn(api, 'sessionChanges').mockResolvedValue({ revision: 0, watching: true });
  const { client, invalidate } = setup();
  await waitFor(() => expect(client.getQueryData(['session-changes'])).toEqual({ revision: 0, watching: true }));
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '刷新会话列表' })).toBeNull();
  await act(() => client.refetchQueries({ queryKey: ['session-changes'] }));
  expect(invalidate).not.toHaveBeenCalled();
  changes.mockResolvedValue({ revision: 1, watching: true });
  await act(() => client.refetchQueries({ queryKey: ['session-changes'] }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['sessions'] }));
});

it('页面隐藏时不请求变化；恢复可见后显示降级说明，手动刷新仍可用', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const changes = vi.spyOn(api, 'sessionChanges').mockRejectedValue(new Error('不可用'));
  const { client, invalidate } = setup();
  expect(changes).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByLabelText('自动更新暂不可用，可手动刷新会话。');
  fireEvent.click(screen.getByRole('button', { name: '刷新会话列表' }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] });
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
  client.clear();
});
