// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RemoteDirectory, RemoteFilePreflight, RemoteFileTask, Workspace } from '@ssh-server/shared';
import { RemoteFilesPanel } from '../../../src/features/remote-files/RemoteFilesPanel';
import { RemoteActionDialog } from '../../../src/features/remote-files/RemoteActionDialog';
import { api } from '../../../src/lib/api';

const workspace: Workspace = {
  id: 'workspace',
  name: 'demo',
  sshHost: 'my-server',
  remoteDir: '/project',
  localDir: 'mirror',
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
  vi.spyOn(api, 'bindRemoteBrowseTarget').mockResolvedValue({ binding: 'binding' });
  vi.spyOn(api, 'createRemoteBrowseSession').mockResolvedValue(session);
  vi.spyOn(api, 'closeRemoteBrowseSession').mockResolvedValue(undefined);
  vi.spyOn(api, 'listRemoteFiles').mockResolvedValue(directory);
  vi.spyOn(api, 'remoteFileTasks').mockResolvedValue({ tasks: [] });
  vi.spyOn(api, 'preflightRemoteFile').mockResolvedValue(preview);
  vi.spyOn(api, 'submitRemoteFileTask').mockResolvedValue(task);
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
  vi.mocked(api.listRemoteFiles).mockResolvedValueOnce(directory).mockResolvedValueOnce(next);
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
  expect(api.listRemoteFiles).toHaveBeenLastCalledWith(
    workspace.id,
    session.id,
    expect.objectContaining({ path: '/project', cursor: 'page-2' }),
    expect.any(AbortSignal),
  );
  expect(api.listRemoteFiles).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});

it('点目录的删除仍先预检并显式确认，保留不可逆风险和后台任务说明', async () => {
  mount();
  fireEvent.contextMenu(await screen.findByRole('button', { name: '.git' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
  expect(screen.getByText(/目录内文件会一并删除，无法自动回滚/)).toBeTruthy();
  expect(api.preflightRemoteFile).not.toHaveBeenCalled();
  expect(api.submitRemoteFileTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '预检操作影响' }));
  const confirm = await screen.findByRole<HTMLButtonElement>('button', { name: '确认执行' });
  expect(api.preflightRemoteFile).toHaveBeenCalledExactlyOnceWith(
    workspace.id,
    session.id,
    { kind: 'delete', source: '/project/.git', destination: undefined },
    expect.any(AbortSignal),
  );
  expect(screen.getByText(/任务提交后在后台运行，关闭面板不会取消/)).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(api.submitRemoteFileTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /已核对服务器、源与目标/ }));
  fireEvent.click(confirm);
  await waitFor(() => expect(api.submitRemoteFileTask).toHaveBeenCalledExactlyOnceWith(workspace.id, preview.id));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(fetch).not.toHaveBeenCalled();
});

it('预检禁止覆盖时保留警告并禁用确认，修改目标后撤销旧预检', async () => {
  vi.mocked(api.preflightRemoteFile).mockResolvedValue({
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
  expect(api.submitRemoteFileTask).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('完整目标路径'), { target: { value: '/project/other.env' } });
  expect(screen.queryByRole('region', { name: '文件操作影响' })).toBeNull();
  expect(api.preflightRemoteFile).toHaveBeenCalledOnce();
  expect(api.submitRemoteFileTask).not.toHaveBeenCalled();
});
