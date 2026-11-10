// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SshConsoleDirectory } from '@agentdeck/shared/ssh';
import { ConsoleFiles } from '../../../../src/builtin-plugins/ssh-console/console/ConsoleFiles';
import { sshConsoleApi } from '../../../../src/builtin-plugins/ssh-console/console/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const directory = (path: string): SshConsoleDirectory => ({
  serverId: 'my-server',
  path,
  parentPath: path.slice(0, path.lastIndexOf('/')) || '/',
  truncated: false,
  entries: [{ name: 'child', path: `${path}/child`, type: 'directory', size: 0, modifiedAt: 1700000000000 }],
});
async function expectPath(path: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: '编辑服务器路径' }).getAttribute('title')).toBe(path));
}
async function go(path: string) {
  fireEvent.click(screen.getByRole('button', { name: '编辑服务器路径' }));
  fireEvent.change(screen.getByRole('textbox', { name: '服务器浏览路径' }), { target: { value: path } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '服务器浏览路径' }), { key: 'Enter' });
  await expectPath(path);
}

it('浏览成功才提交历史，面包屑/后退/前进/刷新共享规范化路径，编辑取消不跳转', async () => {
  vi.spyOn(sshConsoleApi, 'directory').mockImplementation(async (_server, path) => {
    if (path === '/missing') throw new Error('missing');
    return directory(path === '~' ? '/demo' : path);
  });
  render(<ConsoleFiles serverId="my-server" initialDirectory="~" active />);
  await expectPath('/demo');
  fireEvent.click(screen.getByRole('button', { name: '进入 child' }));
  await expectPath('/demo/child');
  expect(screen.getAllByRole('time')[0]?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
  fireEvent.click(screen.getByRole('button', { name: '刷新只读目录' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '后退目录' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '后退目录' }));
  await expectPath('/demo');
  fireEvent.click(screen.getByRole('button', { name: '前进目录' }));
  await expectPath('/demo/child');
  fireEvent.click(screen.getByRole('button', { name: '前往 /demo' }));
  await expectPath('/demo');
  fireEvent.click(screen.getByRole('button', { name: '编辑服务器路径' }));
  const input = screen.getByRole('textbox', { name: '服务器浏览路径' });
  fireEvent.change(input, { target: { value: '/missing' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull();
  await expectPath('/demo');
  await go('/new');
  fireEvent.click(screen.getByRole('button', { name: '编辑服务器路径' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '/missing' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  await screen.findByRole('alert');
  await expectPath('/new');
  fireEvent.click(screen.getByRole('button', { name: '后退目录' }));
  await expectPath('/demo');
  await go('/another');
  expect(screen.getByRole('button', { name: '前进目录' }).hasAttribute('disabled')).toBe(true);
});

it('迟到目录结果不能覆盖后来成功的导航', async () => {
  let resolveOld: (value: SshConsoleDirectory) => void = () => undefined;
  vi.spyOn(sshConsoleApi, 'directory').mockImplementation(async (_server, path) => {
    if (path === '~')
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return directory(path);
  });
  render(<ConsoleFiles serverId="my-server" initialDirectory="~" active />);
  await go('/new');
  await act(async () => {
    resolveOld(directory('/old'));
  });
  await expectPath('/new');
});
