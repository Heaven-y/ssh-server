// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceRemovalResult } from '@ssh-server/shared';
import { WorkspaceRemoveDialog } from '../../../src/features/workspaces/WorkspaceRemoveDialog';
import { api, queryKeys } from '../../../src/lib/api';
import { useChat } from '../../../src/features/chat/chat-store';
import { useTerminalStore } from '../../../src/features/terminal/terminal-store';
import { finishWorkspaceRemoval } from '../../../src/features/workspaces/removal-client';

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return client;
}

const workspace: Workspace = {
  id: 'demo',
  name: '演示工作区',
  localDir: 'fixture-project',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
};
const clients: QueryClient[] = [];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  localStorage.clear();
  useChat.setState({ workspaceId: workspace.id, sessionOperations: {} });
  useTerminalStore.setState({ tabs: [], activeTabId: undefined });
  vi.spyOn(api, 'previewWorkspaceRemoval').mockResolvedValue({
    workspace,
    configuration: 'a'.repeat(64),
    blockers: [],
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

it('仅卸载删除弹窗时，迟到成功仍关闭宿主保留的所属文件面板', async () => {
  let resolve!: (result: WorkspaceRemovalResult) => void;
  const response = new Promise<WorkspaceRemovalResult>((done) => {
    resolve = done;
  });
  const remove = vi.spyOn(api, 'removeWorkspace').mockReturnValue(response);
  const client = createClient();
  client.setQueryData(queryKeys.workspaces, [workspace]);
  const removed = vi.fn();
  function Host({ visible }: { visible: boolean }) {
    const [filesOpen, setFilesOpen] = useState(true);
    return (
      <QueryClientProvider client={client}>
        {filesOpen ? <p>所属文件面板</p> : null}
        {visible ? (
          <WorkspaceRemoveDialog
            workspaceId={workspace.id}
            onClose={() => undefined}
            onRemoved={(id) => {
              removed(id);
              setFilesOpen(false);
            }}
          />
        ) : null}
      </QueryClientProvider>
    );
  }
  const view = render(<Host visible />);
  await view.findByText(workspace.name);
  fireEvent.click(view.getByRole('checkbox'));
  fireEvent.click(view.getByRole('button', { name: '移除配置' }));
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  view.rerender(<Host visible={false} />);
  resolve({ removed: true });
  await waitFor(() => expect(client.getQueryData(queryKeys.workspaces)).toEqual([]));
  await waitFor(() => expect(view.queryByText('所属文件面板')).toBeNull());
  expect(removed).toHaveBeenCalledWith(workspace.id);
});

it('确认默认关闭，阻断及失败保留目标，重新核对后一次提交且最后一项选择清空', async () => {
  const preview = vi.mocked(api.previewWorkspaceRemoval);
  preview.mockResolvedValueOnce({
    workspace,
    configuration: 'a'.repeat(64),
    blockers: [{ code: 'editors_registered', message: '请关闭编辑器' }],
  });
  const remove = vi.spyOn(api, 'removeWorkspace').mockRejectedValueOnce(new Error('配置已经变化'));
  const client = createClient();
  client.setQueryData(queryKeys.workspaces, [workspace]);
  const removed = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <WorkspaceRemoveDialog workspaceId={workspace.id} onClose={() => undefined} onRemoved={removed} />
    </QueryClientProvider>,
  );
  await view.findByText('请关闭编辑器');
  expect((view.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((view.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(view.getByRole('button', { name: '重新核对' }));
  await waitFor(() => expect((view.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false));
  expect((view.getByRole('button', { name: '移除配置' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole('checkbox'));
  fireEvent.submit(view.container.querySelector('form')!);
  fireEvent.submit(view.container.querySelector('form')!);
  await view.findByText('配置已经变化');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(queryKeys.workspaces)).toEqual([workspace]);
  expect(useChat.getState().workspaceId).toBe(workspace.id);
  fireEvent.click(view.getByRole('button', { name: '重新核对' }));
  await waitFor(() => expect((view.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false));
  expect((view.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  remove.mockResolvedValueOnce({ removed: true });
  fireEvent.click(view.getByRole('checkbox'));
  fireEvent.click(view.getByRole('button', { name: '移除配置' }));
  await waitFor(() => expect(removed).toHaveBeenCalledOnce());
  expect(client.getQueryData(queryKeys.workspaces)).toEqual([]);
  expect(useChat.getState().workspaceId).toBeUndefined();
});

it('迟到移除只清理所属缓存和终端，保留新选择及另一工作区', async () => {
  const client = createClient();
  const other = { ...workspace, id: 'other', name: '其他项目' };
  client.setQueryData(queryKeys.workspaces, [workspace, other]);
  for (const id of [workspace.id, other.id]) {
    client.setQueryData(['resources', id, 'target'], { id });
    client.setQueryData(['files', id], { id });
  }
  const target = (id: string) => ({
    workspaceId: id,
    sshHost: 'my-server',
    authMode: 'key' as const,
    remoteDir: '~/projects/demo',
  });
  useTerminalStore.setState({
    tabs: [workspace.id, other.id].map((id) => ({ id, name: id, target: target(id), panes: [], busy: true })),
    activeTabId: other.id,
  });
  useChat.getState().selectWorkspace(other.id);
  await finishWorkspaceRemoval(client, workspace.id);
  expect(useChat.getState().workspaceId).toBe(other.id);
  expect(useTerminalStore.getState().tabs.map((tab) => tab.id)).toEqual([other.id]);
  expect(useTerminalStore.getState().activeTabId).toBe(other.id);
  expect(client.getQueryData(['resources', workspace.id, 'target'])).toBeUndefined();
  expect(client.getQueryData(['files', workspace.id])).toBeUndefined();
  expect(client.getQueryData(['resources', other.id, 'target'])).toEqual({ id: other.id });
  expect(client.getQueryData(['files', other.id])).toEqual({ id: other.id });
});
