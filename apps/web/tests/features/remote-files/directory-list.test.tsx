// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RemoteFileActionInput } from '@ssh-server/shared';
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
}: {
  action?: (input: RemoteFileActionInput) => void;
  navigate?: (path: string) => void;
}) {
  const [selected, select] = useState<string>();
  return (
    <RemoteDirectoryList
      directory={directory}
      showHidden={false}
      loading={false}
      selectedPath={selected}
      select={select}
      action={action}
      navigate={navigate}
      download={vi.fn()}
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
