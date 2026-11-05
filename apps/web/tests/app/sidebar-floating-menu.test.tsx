// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { Sidebar } from '../../src/app/Sidebar';
import { api } from '../../src/lib/api';
import { useUiPreferences } from '../../src/ui/ui-preferences';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('更多菜单固定挂到 portal，焦点占位不再参与工作区上方的 margin 间距', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, 'sessionChanges').mockResolvedValue({ revision: 1, watching: true });
  useUiPreferences.setState({ sidebarCollapsed: false, sidebarAutoCollapsed: false });
  const archive = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <Sidebar projects={[]} sessionsByProject={{}} onAddProject={vi.fn()} onOpenArchive={archive} />
    </QueryClientProvider>,
  );
  const more = screen.getByRole('button', { name: '更多' });
  const group = more.parentElement!;
  expect(group.className).toContain('flex-col gap-0.5');
  expect(group.className).not.toContain('space-y');
  fireEvent.click(more);
  const menu = await screen.findByRole('menu', { name: '更多导航' });
  expect(view.container.contains(menu)).toBe(false);
  await waitFor(() => expect(menu.parentElement!.style.position).toBe('fixed'));
  expect(group.contains(menu)).toBe(false);
  fireEvent.click(screen.getByRole('menuitem', { name: '已归档会话' }));
  expect(archive).toHaveBeenCalledOnce();
  client.clear();
});
