// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { FileDirectory } from '../../../src/features/files/FileDirectory';
import { api } from '../../../src/lib/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('本地默认工作区根，单击选中、双击或菜单打开，进入子目录后可返回根', async () => {
  vi.spyOn(api, 'listFiles').mockImplementation(async (_id, directory) => ({
    path: directory ?? '',
    truncated: false,
    entries: directory
      ? []
      : [
          { path: 'src', name: 'src', kind: 'directory' },
          { path: 'file.py', name: 'file.py', kind: 'file', size: 12 },
        ],
  }));
  const openFile = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <FileDirectory workspaceId="workspace" disabled={false} openFile={openFile} />
    </QueryClientProvider>,
  );
  const file = await screen.findByRole('button', { name: /^file.py/ });
  fireEvent.click(file);
  expect(openFile).not.toHaveBeenCalled();
  fireEvent.doubleClick(file);
  expect(openFile).toHaveBeenCalledWith('file.py');
  fireEvent.contextMenu(file);
  fireEvent.click(await screen.findByRole('menuitem', { name: '打开文件' }));
  expect(openFile).toHaveBeenCalledTimes(2);
  fireEvent.doubleClick(screen.getByRole('button', { name: 'src' }));
  await screen.findByText('此目录没有同步范围内的文件。');
  fireEvent.click(screen.getByRole('button', { name: '返回工作区根目录' }));
  expect(await screen.findByRole('button', { name: 'file.py' })).toBeTruthy();
  client.clear();
});
