// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SshConsoleTerminal } from '@agentdeck/shared';
import { sshConsoleApi } from '../../../src/lib/ssh-console-api';
import { useConsoleTerminals } from '../../../src/features/ssh-console/use-console-terminals';

const terminal: SshConsoleTerminal = {
  id: 'session-one',
  serverId: 'my-server',
  cols: 100,
  rows: 30,
  startDir: '~',
  startedAt: 1,
  exited: false,
  exitCode: null,
  signal: null,
  seq: 20,
  start: 0,
  inputPaused: false,
};
beforeEach(() => {
  vi.spyOn(sshConsoleApi, 'terminals').mockResolvedValue({ terminals: [terminal] });
  vi.spyOn(sshConsoleApi, 'createTerminal').mockResolvedValue({ ...terminal, id: 'session-two' });
  vi.spyOn(sshConsoleApi, 'closeTerminal').mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('重开查询后端现有PTY而不创建重复shell，隐藏与卸载均不关闭', async () => {
  const view = renderHook(({ visible }) => useConsoleTerminals('my-server', '~', visible), {
    initialProps: { visible: false },
  });
  expect(sshConsoleApi.terminals).not.toHaveBeenCalled();
  view.rerender({ visible: true });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  expect(view.result.current.selected).toBe('session-one');
  expect(sshConsoleApi.createTerminal).not.toHaveBeenCalled();
  view.rerender({ visible: false });
  view.unmount();
  expect(sshConsoleApi.closeTerminal).not.toHaveBeenCalled();
  const next = renderHook(() => useConsoleTerminals('my-server', '~', true));
  await waitFor(() => expect(next.result.current.terminals).toEqual([terminal]));
  expect(sshConsoleApi.createTerminal).not.toHaveBeenCalled();
});

it('并发挂载首次空列表只创建一个PTY；明确新建与关闭只影响指定终端', async () => {
  vi.mocked(sshConsoleApi.terminals).mockResolvedValue({ terminals: [] });
  vi.mocked(sshConsoleApi.createTerminal).mockResolvedValueOnce(terminal);
  const first = renderHook(() => useConsoleTerminals('my-server', '~/projects/demo', true));
  const second = renderHook(() => useConsoleTerminals('my-server', '~/projects/demo', true));
  await waitFor(() => expect(first.result.current.ready && second.result.current.ready).toBe(true));
  expect(sshConsoleApi.createTerminal).toHaveBeenCalledTimes(1);
  expect(sshConsoleApi.createTerminal).toHaveBeenCalledWith('my-server', {
    cols: 100,
    rows: 30,
    remoteDir: '~/projects/demo',
  });
  await act(async () => {
    await first.result.current.create();
  });
  expect(first.result.current.terminals.map(({ id }) => id)).toEqual(['session-one', 'session-two']);
  await act(async () => {
    await first.result.current.close('session-two');
  });
  expect(sshConsoleApi.closeTerminal).toHaveBeenCalledWith('my-server', 'session-two');
  expect(first.result.current.terminals).toEqual([terminal]);
  expect(first.result.current.selected).toBe('session-one');
});
