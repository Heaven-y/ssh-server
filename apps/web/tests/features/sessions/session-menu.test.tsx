// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionSummary } from '@agentdeck/shared/conversation';
import { SessionMenu } from '../../../src/features/sessions/SessionMenu';

afterEach(cleanup);
const session: SessionSummary = {
  agent: 'antigravity',
  sessionId: 'native-id',
  projectId: 'project',
  title: '示例',
  updatedAt: new Date(1).toISOString(),
  running: false,
  capabilities: { rename: false, fork: null, delete: null, archive: 'workbench' },
};
it('工作台归档来源保留菜单，尚未接入的原生分支和删除不出现', async () => {
  const choose = vi.fn();
  render(
    <SessionMenu
      session={session}
      archived={false}
      pinned={false}
      disabled={false}
      localActions={false}
      choose={choose}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Antigravity.*更多操作/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '归档' }));
  expect(choose).toHaveBeenCalledExactlyOnceWith('archive');
  expect(screen.queryByRole('menuitem', { name: '创建分支' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull();
});
it('服务端接入原生动作后直接显示创建分支和删除，不出现命令行跳转', async () => {
  render(
    <SessionMenu
      session={{ ...session, capabilities: { rename: true, fork: 'native', delete: 'native', archive: 'workbench' } }}
      archived={false}
      pinned={false}
      disabled={false}
      localActions={false}
      choose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /更多操作/ }));
  expect(await screen.findByRole('menuitem', { name: '创建分支' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: /CLI/ })).toBeNull();
});

it('会话运行中仍能复制原生 ID，修改操作保持禁用', async () => {
  const choose = vi.fn();
  render(
    <SessionMenu session={session} archived={false} pinned={false} disabled localActions={false} choose={choose} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /更多操作/ }));
  expect((await screen.findByRole('menuitem', { name: '归档' })).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: '复制会话 ID' }));
  expect(choose).toHaveBeenCalledExactlyOnceWith('copy-id');
});
