// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ManagedServer, Workspace } from '@agentdeck/shared';
import { BindServerDialog } from '../../src/app/BindServerDialog';
import { api } from '../../src/lib/api';

const project: Workspace = { id: 'p1', name: '示例项目', dir: 'E:\\web\\demo' };
const server = {
  alias: 'managed-ssh-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  name: 'my-server',
  hostname: 'my-server',
  port: 22,
  username: 'demo',
  authMode: 'key',
} as ManagedServer;

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

function mount(target: Workspace = project) {
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <BindServerDialog project={target} onClose={close} />
    </QueryClientProvider>,
  );
  return close;
}

it('绑定服务器必须同时给默认目录，两者成对提交', async () => {
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  const update = vi
    .spyOn(api, 'updateProject')
    .mockResolvedValue({ ...project, server: server.alias, remoteDir: '~/x' });
  const close = mount();
  // 选项是异步拉到的：必须等 <option> 真的出现再改 select，否则 jsdom 会把值退回空串。
  const select = await screen.findByLabelText('服务器');
  await screen.findByRole('option', { name: /my-server/ });
  fireEvent.change(select, { target: { value: server.alias } });
  expect((select as HTMLSelectElement).value).toBe(server.alias);
  fireEvent.change(screen.getByLabelText('服务器上的默认目录'), { target: { value: '~/x' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { server: server.alias, remoteDir: '~/x' }));
  expect(close).toHaveBeenCalled();
});

it('解绑一次清掉两半，避免留下打不开面板的半绑定态', async () => {
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  const update = vi.spyOn(api, 'updateProject').mockResolvedValue(project);
  mount({ ...project, server: server.alias, remoteDir: '~/x' });
  fireEvent.click(screen.getByRole('button', { name: '解绑' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { server: null, remoteDir: null }));
});

it('未绑定的项目没有解绑按钮', () => {
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  mount();
  expect(screen.queryByRole('button', { name: '解绑' })).toBeNull();
});

it('手工改坏成半绑定时明确报错，而不是悄悄留着', () => {
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  mount({ ...project, server: server.alias });
  expect(screen.getByRole('alert').textContent).toContain('缺少另一半');
});

it('还没有登记服务器时说明先去添加', async () => {
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([]);
  mount();
  expect(await screen.findByText(/还没有登记服务器/)).toBeTruthy();
});

it('目录离线时也能把项目从列表移除，不必手改配置文件', async () => {
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  const remove = vi.spyOn(api, 'deleteProject').mockResolvedValue(undefined);
  const close = mount();
  fireEvent.click(screen.getByRole('button', { name: /从列表移除这个项目/ }));
  // 移除不可撤销，必须先确认，且要说清不动磁盘目录。
  expect(screen.getByText(/不动磁盘上的目录/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '移除' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('p1'));
  expect(close).toHaveBeenCalled();
});
