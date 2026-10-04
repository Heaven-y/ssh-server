import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { workspaceTerminalTarget, type Workspace, type TerminalBinding } from '@ssh-server/shared';
import { api, ApiError } from '../../../src/lib/api';
import {
  activateTerminalPane,
  activateTerminalTab,
  addTerminalPane,
  closeTerminalPane,
  closeTerminalTab,
  ensureInitialTerminal,
  openTerminalTab,
  setTerminalPaneStatus,
  terminalPaneIsActive,
  useTerminalStore,
} from '../../../src/features/terminal/terminal-store';

const workspace: Workspace = {
  id: 'w',
  name: '工作区',
  localDir: path.resolve('fixture'),
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const binding = (ws = workspace): TerminalBinding => ({
  target: workspaceTerminalTarget(ws),
  expiresAt: Date.now() + 300000,
  binding: `1.1234.${'a'.repeat(32)}.${'b'.repeat(64)}`,
});
afterEach(() => {
  for (const tab of useTerminalStore.getState().tabs) closeTerminalTab(tab.id);
  useTerminalStore.setState({ tabs: [], initialized: false, activeTabId: undefined, notice: '' });
  vi.restoreAllMocks();
});

it('固定标签目标，刷新只影响新pane，分屏/关闭保留现存身份及状态', async () => {
  const bind = vi.spyOn(api, 'bindTerminalTarget').mockResolvedValue(binding());
  ensureInitialTerminal(workspace);
  ensureInitialTerminal(workspace);
  await vi.waitFor(() => expect(useTerminalStore.getState().tabs[0]?.panes).toHaveLength(1));
  expect(bind).toHaveBeenCalledOnce();
  const first = useTerminalStore.getState().tabs[0]!;
  const original = first.panes[0]!;
  setTerminalPaneStatus(original.id, { phase: 'ready', message: '已连接' });
  expect(terminalPaneIsActive(useTerminalStore.getState().tabs[0]!.panes[0]!.status)).toBe(true);
  await addTerminalPane(first.id, 'horizontal');
  await addTerminalPane(first.id, 'vertical');
  await addTerminalPane(first.id, 'horizontal');
  await addTerminalPane(first.id, 'vertical');
  const tab = useTerminalStore.getState().tabs[0]!;
  expect(tab.panes).toHaveLength(4);
  expect(useTerminalStore.getState().notice).toContain('4');
  expect(tab.panes[0]!.target).toBe(original.target);
  expect(tab.panes[0]!.binding).toBe(original.binding);
  expect(bind.mock.calls[1]![0]).toEqual(first.target);
  expect(bind.mock.calls[1]![1]?.previousBinding).toBe(first.binding!.binding);
  activateTerminalPane(original.id);
  await addTerminalPane(first.id, 'replace');
  expect(useTerminalStore.getState().tabs[0]!.panes.some((p) => p.id === original.id)).toBe(false);
  const active = useTerminalStore.getState().tabs[0]!.activePaneId!;
  closeTerminalPane(first.id, active);
  expect(useTerminalStore.getState().tabs[0]!.panes).toHaveLength(3);
});
it('关闭待绑定标签取消请求，迟到结果不能恢复标签或改写新选择', async () => {
  let resolve!: (value: TerminalBinding) => void;
  const bind = vi
    .spyOn(api, 'bindTerminalTarget')
    .mockImplementationOnce(
      () =>
        new Promise<TerminalBinding>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(binding());
  const pending = openTerminalTab(workspace);
  const old = useTerminalStore.getState().tabs[0]!;
  closeTerminalTab(old.id);
  expect(bind.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  await openTerminalTab(workspace);
  const next = useTerminalStore.getState().activeTabId;
  resolve(binding());
  await pending;
  expect(useTerminalStore.getState().tabs).toHaveLength(1);
  expect(useTerminalStore.getState().activeTabId).toBe(next);
  activateTerminalTab(next!);
  closeTerminalPane(next!, useTerminalStore.getState().tabs[0]!.panes[0]!.id);
  expect(useTerminalStore.getState().tabs).toEqual([]);
});
it('旧标签刷新失败保留可查看的旧pane，新标签绑定失败显示服务端原因', async () => {
  const bind = vi
    .spyOn(api, 'bindTerminalTarget')
    .mockResolvedValueOnce(binding())
    .mockRejectedValue(new ApiError(409, '目标已变化'));
  await openTerminalTab(workspace);
  const tab = useTerminalStore.getState().tabs[0]!;
  await addTerminalPane(tab.id, 'horizontal');
  expect(useTerminalStore.getState().tabs[0]!.error).toBe('目标已变化');
  expect(useTerminalStore.getState().tabs[0]!.panes[0]).toBe(tab.panes[0]);
  await openTerminalTab(workspace);
  expect(useTerminalStore.getState().tabs[1]!.error).toBe('目标已变化');
  expect(bind).toHaveBeenCalledTimes(3);
});
