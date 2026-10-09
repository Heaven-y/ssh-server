// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RemoteDirectory, RemoteFileActionInput, RemoteFileEntry } from '@ssh-server/shared';
import { RemoteActionToolbar } from '../../../src/features/remote-files/RemoteActionToolbar';
import { RemoteDirectoryList } from '../../../src/features/remote-files/RemoteDirectoryList';

afterEach(cleanup);
const directory = {
  path: '/project',
  root: '/project',
  outsideWorkspace: false,
  entries: [
    { name: 'folder', path: '/project/folder', type: 'directory' as const, scope: 'directory' as const },
    { name: 'file2.py', path: '/project/file2.py', type: 'file' as const, size: 12, scope: 'included' as const },
  ],
};
function Harness({
  action = vi.fn(),
  navigate = vi.fn(),
  download = vi.fn(),
  listing = directory,
}: {
  action?: (input: RemoteFileActionInput) => void;
  navigate?: (path: string) => void;
  download?: (entry: RemoteFileEntry) => void;
  listing?: RemoteDirectory;
}) {
  const [selected, select] = useState<string>();
  return (
    <RemoteDirectoryList
      directory={listing}
      loading={false}
      selectedPath={selected}
      select={select}
      action={action}
      navigate={navigate}
      download={download}
      sessionId="session"
    />
  );
}

it('工具栏只留目录级入口，不再常驻文件重命名移动等按钮', () => {
  const create = vi.fn();
  render(<RemoteActionToolbar disabled={false} create={create} />);
  expect(screen.queryByRole('button', { name: '重命名' })).toBeNull();
  expect(screen.queryByRole('button', { name: '移动到…' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
  expect(create).toHaveBeenCalledOnce();
});

it('单击只选中，右键及F2使用选中条目的原有确认入口，详情按需展开', async () => {
  const action = vi.fn();
  render(<Harness action={action} />);
  const file = screen.getByRole('button', { name: /^file2.py/, pressed: false });
  fireEvent.click(file);
  expect(action).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: '服务器文件元数据' })).toBeNull();
  fireEvent.keyDown(file, { key: 'F2' });
  expect(action).toHaveBeenLastCalledWith({
    kind: 'rename',
    source: '/project/file2.py',
    destination: '/project/file2.py',
  });
  fireEvent.contextMenu(file);
  fireEvent.click(await screen.findByRole('menuitem', { name: /移动到/ }));
  expect(action).toHaveBeenLastCalledWith({ kind: 'move', source: '/project/file2.py', destination: undefined });
  fireEvent.keyDown(file, { key: 'F10', shiftKey: true });
  fireEvent.click(await screen.findByRole('menuitem', { name: '属性' }));
  expect(screen.getByRole('region', { name: '服务器文件元数据' }).textContent).toContain('在同步范围内');
});

it('方向键导航与Enter打开目录，不因选中即进入', async () => {
  const navigate = vi.fn();
  render(<Harness navigate={navigate} />);
  const folder = screen.getByRole('button', { name: /^folder/, pressed: false });
  const file = screen.getByRole('button', { name: /^file2.py/, pressed: false });
  fireEvent.click(folder);
  expect(navigate).not.toHaveBeenCalled();
  folder.focus();
  fireEvent.keyDown(folder, { key: 'ArrowDown' });
  await waitFor(() => expect(document.activeElement).toBe(file));
  fireEvent.keyDown(file, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(folder);
  fireEvent.keyDown(folder, { key: 'Enter' });
  expect(navigate).toHaveBeenCalledWith('/project/folder');
});

it('同一浏览会话拖放只提交待确认操作，外部与其他会话拖放不提交', () => {
  const action = vi.fn();
  render(<Harness action={action} />);
  const folder = screen.getByRole('button', { name: /^folder/, pressed: false }).closest('li')!;
  const transfer = (sessionId: string) => ({
    types: ['application/x-ssh-server-remote-file'],
    getData: () => JSON.stringify({ sessionId, path: '/project/file2.py' }),
  });
  fireEvent.drop(folder, { dataTransfer: transfer('other') });
  expect(action).not.toHaveBeenCalled();
  fireEvent.drop(folder, { dataTransfer: transfer('session') });
  expect(action).toHaveBeenLastCalledWith({
    kind: 'move',
    source: '/project/file2.py',
    destination: '/project/folder/file2.py',
  });
});

it('默认按服务返回顺序显示点文件和点目录，打开与菜单操作仍可用', async () => {
  const navigate = vi.fn();
  const action = vi.fn();
  const download = vi.fn();
  const hiddenDirectory = {
    name: '.git',
    path: '/project/.git',
    type: 'directory' as const,
    scope: 'excluded' as const,
  };
  const hiddenFile = { name: '.env', path: '/project/.env', type: 'file' as const, scope: 'excluded' as const };
  const listing = { ...directory, entries: [hiddenDirectory, hiddenFile, ...directory.entries], nextCursor: 'page-2' };
  render(<Harness listing={listing} navigate={navigate} action={action} download={download} />);
  expect(screen.getAllByRole('button', { pressed: false }).map((button) => button.getAttribute('aria-label'))).toEqual([
    '.git',
    '.env',
    'folder',
    'file2.py',
  ]);
  const folder = screen.getByRole('button', { name: '.git' });
  fireEvent.click(folder);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.keyDown(folder, { key: 'Enter' });
  expect(navigate).toHaveBeenLastCalledWith('/project/.git');
  fireEvent.contextMenu(folder);
  fireEvent.click(await screen.findByRole('menuitem', { name: '打开目录' }));
  expect(navigate).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '.env的操作菜单' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
  expect(action).toHaveBeenCalledExactlyOnceWith({
    kind: 'rename',
    source: '/project/.env',
    destination: '/project/.env',
  });
  fireEvent.contextMenu(screen.getByRole('button', { name: '.env' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '下载…' }));
  expect(download).toHaveBeenCalledExactlyOnceWith(hiddenFile);
});
