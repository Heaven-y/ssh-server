// @vitest-environment jsdom
import { remoteFilesApi } from '../../../../../src/builtin-plugins/ssh-console/legacy/remote-files/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BoundWorkspace } from '@agentdeck/shared/projects';
import type { RemoteDirectory, RemoteFilePreflight, RemoteFileTask } from '@agentdeck/shared/ssh';
import { RemoteFilesPanel } from '../../../../../src/builtin-plugins/ssh-console/legacy/remote-files/RemoteFilesPanel';
import { RemoteActionDialog } from '../../../../../src/builtin-plugins/ssh-console/legacy/remote-files/RemoteActionDialog';

const workspace: BoundWorkspace = {
  id: 'workspace',
  name: 'demo',
  server: 'my-server',
  remoteDir: '/project',
  dir: 'mirror',
};
const session = {
  id: 'session',
  workspaceId: workspace.id,
  sshHost: 'my-server',
  root: '/project',
  home: '/home/demo',
};
const directory: RemoteDirectory = {
  path: '/project',
  root: '/project',
  outsideWorkspace: false,
  entries: [
    { name: '.git', path: '/project/.git', type: 'directory', scope: 'excluded' },
    { name: '.env', path: '/project/.env', type: 'file', scope: 'excluded' },
  ],
  nextCursor: 'page-2',
};
const preview: RemoteFilePreflight = {
  id: 'preflight',
  workspaceId: workspace.id,
  sshHost: 'my-server',
  kind: 'delete',
  source: '/project/.git',
  sourceType: 'directory',
  expiresAt: 1000,
  entries: 2,
  files: 1,
  bytes: 20,
  crossFilesystem: false,
  affectedWorkspaces: [],
  warnings: [],
  canSubmit: true,
};
const task: RemoteFileTask = {
  id: 'task',
  workspaceId: workspace.id,
  preflightId: preview.id,
  sshHost: 'my-server',
  kind: 'delete',
  source: preview.source,
  phase: 'queued',
  createdAt: 1,
  updatedAt: 1,
  cancelRequested: false,
  remoteCompleted: false,
  syncCompleted: false,
  syncRequired: false,
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(remoteFilesApi, 'bindRemoteBrowseTarget').mockResolvedValue({ binding: 'binding' });
  vi.spyOn(remoteFilesApi, 'createRemoteBrowseSession').mockResolvedValue(session);
  vi.spyOn(remoteFilesApi, 'closeRemoteBrowseSession').mockResolvedValue(undefined);
  vi.spyOn(remoteFilesApi, 'listRemoteFiles').mockResolvedValue(directory);
  vi.spyOn(remoteFilesApi, 'remoteFileTasks').mockResolvedValue({ tasks: [] });
  vi.spyOn(remoteFilesApi, 'preflightRemoteFile').mockResolvedValue(preview);
  vi.spyOn(remoteFilesApi, 'submitRemoteFileTask').mockResolvedValue(task);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <RemoteFilesPanel workspace={workspace} active />
    </QueryClientProvider>,
  );
}

it('服务器面板没有隐藏项开关，分页完整显示当前页的点文件且不读取正文', async () => {
  const next: RemoteDirectory = {
    ...directory,
    entries: [{ name: '.editorconfig', path: '/project/.editorconfig', type: 'file', scope: 'included' }],
    nextCursor: undefined,
  };
  vi.mocked(remoteFilesApi.listRemoteFiles).mockResolvedValueOnce(directory).mockResolvedValueOnce(next);
  mount();
  await screen.findByRole('button', { name: '.git' });
  expect(screen.getByRole('button', { name: '.env' })).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText('第 1 页 · 2 项')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByRole('button', { name: '.editorconfig' });
  expect(screen.queryByRole('button', { name: '.env' })).toBeNull();
  expect(screen.getByText('第 2 页 · 1 项')).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一页' }).disabled).toBe(true);
  expect(remoteFilesApi.listRemoteFiles).toHaveBeenLastCalledWith(
    workspace.id,
    session.id,
    expect.objectContaining({ path: '/project', cursor: 'page-2' }),
    expect.any(AbortSignal),
  );
  expect(remoteFilesApi.listRemoteFiles).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});

it('点目录的删除仍先预检并显式确认，保留不可逆风险和后台任务说明', async () => {
  mount();
  fireEvent.contextMenu(await screen.findByRole('button', { name: '.git' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
  expect(screen.getByText(/目录内文件会一并删除，无法自动回滚/)).toBeTruthy();
  expect(remoteFilesApi.preflightRemoteFile).not.toHaveBeenCalled();
  expect(remoteFilesApi.submitRemoteFileTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '预检操作影响' }));
  const confirm = await screen.findByRole<HTMLButtonElement>('button', { name: '确认执行' });
  expect(remoteFilesApi.preflightRemoteFile).toHaveBeenCalledExactlyOnceWith(
    workspace.id,
    session.id,
    { kind: 'delete', source: '/project/.git', destination: undefined },
    expect.any(AbortSignal),
  );
  expect(screen.getByText(/任务提交后在后台运行/)).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(remoteFilesApi.submitRemoteFileTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /已核对以上影响/ }));
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(remoteFilesApi.submitRemoteFileTask).toHaveBeenCalledExactlyOnceWith(workspace.id, preview.id),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fetch).not.toHaveBeenCalled();
});

it('预检禁止覆盖时保留警告并禁用确认，修改目标后撤销旧预检', async () => {
  vi.mocked(remoteFilesApi.preflightRemoteFile).mockResolvedValue({
    ...preview,
    kind: 'copy',
    source: '/project/.env',
    destination: '/project/copy.env',
    canSubmit: false,
    warnings: ['目标已存在'],
  });
  render(
    <RemoteActionDialog
      workspaceId={workspace.id}
      session={session}
      input={{ kind: 'copy', source: '/project/.env', destination: '/project/copy.env' }}
      currentPath="/project"
      connect={vi.fn()}
      submitted={vi.fn()}
      close={vi.fn()}
    />,
  );
  expect(screen.getByText(/同名目标不会覆盖，目录不会合并/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '预检操作影响' }));
  await screen.findByText('目标已存在');
  expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
  const confirm = screen.getByRole<HTMLButtonElement>('button', { name: '确认执行' });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(remoteFilesApi.submitRemoteFileTask).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('完整目标路径'), { target: { value: '/project/other.env' } });
  expect(screen.queryByRole('region', { name: '文件操作影响' })).toBeNull();
  expect(remoteFilesApi.preflightRemoteFile).toHaveBeenCalledOnce();
  expect(remoteFilesApi.submitRemoteFileTask).not.toHaveBeenCalled();
});
