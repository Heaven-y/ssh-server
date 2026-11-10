// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SshConsoleTerminal } from '@agentdeck/shared/ssh';
import { sshConsoleApi } from '../../../../src/builtin-plugins/ssh-console/console/api';
import { useConsoleTerminals } from '../../../../src/builtin-plugins/ssh-console/console/use-console-terminals';
import ConsoleTerminals from '../../../../src/builtin-plugins/ssh-console/console/ConsoleTerminals';

vi.mock('../../../../src/builtin-plugins/ssh-console/console/ConsoleTerminalPane', () => ({
  ConsoleTerminalPane: ({ terminalId, visible }: { terminalId: string; visible: boolean }) => (
    <section aria-label={`窗格 ${terminalId}`} hidden={!visible}>
      终端内容
    </section>
  ),
}));

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

it('单终端可一键分屏，三终端切换仅替换焦点窗格，取消分屏保留点中的窗格', async () => {
  vi.mocked(sshConsoleApi.createTerminal)
    .mockResolvedValueOnce({ ...terminal, id: 'session-two' })
    .mockResolvedValueOnce({ ...terminal, id: 'session-three' });
  render(<ConsoleTerminals serverId="my-server" directory="~" visible />);
  await screen.findByRole('button', { name: '终端 1' });
  fireEvent.click(screen.getByRole('button', { name: '左右分屏' }));
  await screen.findByRole('region', { name: '窗格 session-two' });
  expect(screen.getAllByRole('region', { name: /^窗格/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '新建终端' }));
  await screen.findByRole('region', { name: '窗格 session-three' });
  fireEvent.click(screen.getByRole('button', { name: '上下分屏' }));
  await screen.findByRole('region', { name: '窗格 session-one' });
  fireEvent.click(screen.getByRole('button', { name: '终端 2' }));
  expect(screen.getByRole('region', { name: '窗格 session-three' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '窗格 session-two' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: '窗格 session-one' })).toBeNull();
  fireEvent.pointerDown(screen.getByRole('region', { name: '窗格 session-three' }));
  fireEvent.click(screen.getByRole('button', { name: '取消分屏' }));
  expect(screen.getAllByRole('region', { name: /^窗格/ })).toHaveLength(1);
  expect(screen.getByRole('region', { name: '窗格 session-three' })).toBeTruthy();
  expect(sshConsoleApi.closeTerminal).not.toHaveBeenCalled();
});

it('分屏创建的迟到结果不覆盖用户后来选择的窗格', async () => {
  let resolve: (value: SshConsoleTerminal) => void = () => undefined;
  vi.mocked(sshConsoleApi.createTerminal).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<ConsoleTerminals serverId="my-server" directory="~" visible />);
  await screen.findByRole('button', { name: '终端 1' });
  fireEvent.click(screen.getByRole('button', { name: '左右分屏' }));
  fireEvent.click(screen.getByRole('button', { name: '终端 1' }));
  await act(async () => {
    resolve({ ...terminal, id: 'session-two' });
  });
  await screen.findByRole('button', { name: '终端 2' });
  expect(screen.getAllByRole('region', { name: /^窗格/ })).toHaveLength(1);
  expect(screen.getByRole('region', { name: '窗格 session-one' })).toBeTruthy();
});
