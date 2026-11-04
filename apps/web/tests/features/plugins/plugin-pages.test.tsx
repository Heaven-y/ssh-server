// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { pluginApi } from '../../../src/features/plugins/plugin-api';
import { usePluginPages } from '../../../src/features/plugins/use-plugin-pages';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('命令绑定来源插件，侧栏打开另一插件不重放旧命令', async () => {
  vi.spyOn(pluginApi, 'list').mockResolvedValue({
    revision: 'missing',
    plugins: ['first', 'second'].map((id) => ({
      enabled: true,
      builtin: false,
      manifest: {
        id,
        name: id,
        version: '1.0.0',
        apiVersion: 1,
        entry: 'index.html',
        permissions: [],
        commands: [{ id: 'open', title: id }],
      },
    })),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(usePluginPages, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.commands).toHaveLength(2));
  act(() => {
    result.current.commands[0]!.run();
  });
  expect(result.current.command).toMatchObject({ pluginId: 'first', id: 'open' });
  act(() => result.current.show('second'));
  expect(result.current.selected).toBe('second');
  expect(result.current.command).toBeUndefined();
  client.clear();
});
