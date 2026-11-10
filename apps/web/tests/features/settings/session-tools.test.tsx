// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../../src/lib/query-client';
import { SessionToolsPanel } from '../../../src/features/settings/SessionToolsPanel';

afterEach(async () => {
  cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  vi.unstubAllGlobals();
});
it('按当前 CLI 显式启用，冲突保留状态并可重新读取', async () => {
  let enabled = false;
  let conflict = false;
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        writes.push({ url, body: JSON.parse(typeof init.body === 'string' ? init.body : '') });
        if (conflict) return Response.json({ message: '原生配置已改变，请刷新后重试。' }, { status: 409 });
        enabled = true;
      }
      return Response.json({ agent: 'antigravity', enabled, available: true, revision: 'revision-1' });
    }),
  );
  render(<SessionToolsPanel agent="antigravity" />);
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '启用会话读取' }).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '启用会话读取' }));
  await screen.findByRole('button', { name: '停用会话读取' });
  expect(writes).toEqual([{ url: '/api/session-tools/antigravity', body: { enabled: true, revision: 'revision-1' } }]);
  conflict = true;
  fireEvent.click(screen.getByRole('button', { name: '停用会话读取' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '原生配置已改变，请刷新后重试。');
  expect(screen.getByRole('button', { name: '停用会话读取' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
