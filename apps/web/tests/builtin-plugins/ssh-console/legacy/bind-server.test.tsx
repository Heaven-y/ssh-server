// @vitest-environment jsdom
import { projectsApi } from '../../../../src/features/projects/api';
import { sshApi } from '../../../../src/builtin-plugins/ssh-console/ssh/api';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ManagedServer } from '@agentdeck/shared/ssh';
import type { Workspace } from '@agentdeck/shared/projects';
import { BindServerDialog } from '../../../../src/builtin-plugins/ssh-console/legacy/BindServerDialog';

import { useChat } from '../../../../src/features/chat/chat-store';

const project: Workspace = { id: 'p1', name: '示例项目', dir: path.resolve('fixtures', 'demo') };
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
  useChat.setState(useChat.getInitialState(), true);
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
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([server]);
  const update = vi
    .spyOn(projectsApi, 'updateProject')
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
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([server]);
  const update = vi.spyOn(projectsApi, 'updateProject').mockResolvedValue(project);
  mount({ ...project, server: server.alias, remoteDir: '~/x' });
  expect(screen.queryByText(/缺少另一半/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '解绑' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith('p1', { server: null, remoteDir: null }));
});

it('未绑定的项目没有解绑按钮', () => {
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([server]);
  mount();
  expect(screen.queryByRole('button', { name: '解绑' })).toBeNull();
});

it('手工改坏成半绑定时明确报错，而不是悄悄留着', () => {
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([server]);
  mount({ ...project, server: server.alias });
  expect(screen.getByRole('alert').textContent).toContain('缺少另一半');
});

it('半绑定只剩远端目录时选择不绑定会一次清除两项', async () => {
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([server]);
  const update = vi.spyOn(projectsApi, 'updateProject').mockResolvedValue(project);
  mount({ ...project, remoteDir: '~/projects/demo' });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(project.id, { server: null, remoteDir: null }));
});

it('还没有登记服务器时说明先去添加', async () => {
  vi.spyOn(sshApi, 'listSshHosts').mockResolvedValue([]);
  mount();
  expect(await screen.findByText(/还没有登记服务器/)).toBeTruthy();
});
