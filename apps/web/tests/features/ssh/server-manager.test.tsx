// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostTrustStatus, ManagedServer } from '@ssh-server/shared';
import { api, ApiError } from '../../../src/lib/api';
import { ServerManagerDialog } from '../../../src/features/ssh/ServerManagerDialog';
import { ServerStep } from '../../../src/features/workspaces/setup/ServerStep';

const server: ManagedServer = {
  alias: 'my-server',
  name: '演示服务器',
  hostname: 'my-server',
  username: 'user',
  port: 22,
  authMode: 'password',
};
const status = { connected: false, hasPassword: false, saved: false, paused: false, savingAvailable: true };
const clients: QueryClient[] = [];
function mount(onSelect = vi.fn(), initialAlias = server.alias) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const close = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ServerManagerDialog initialAlias={initialAlias} onClose={close} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { ...view, close, onSelect, client };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  vi.spyOn(api, 'listWorkspaces').mockResolvedValue([
    { id: 'w', name: '项目一', localDir: 'demo', sshHost: server.alias, remoteDir: '~/demo' },
  ]);
  vi.spyOn(api, 'sshCredentials').mockResolvedValue(status);
  vi.spyOn(api, 'readSshPassword').mockResolvedValue({
    password: null,
    revision: 'a'.repeat(64),
    savingAvailable: true,
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
});
it('集中管理显示引用影响、选择档案；密码只在当前表单中，发送与关闭清理', async () => {
  let finish!: (result: typeof status & { connected: true; authMode: 'password' }) => void;
  vi.spyOn(api, 'connectSsh').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const f = mount();
  const password = await screen.findByLabelText<HTMLInputElement>('SSH 密码');
  expect(await screen.findByText(/项目一/)).toBeTruthy();
  fireEvent.change(password, { target: { value: 'temporary-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  expect(password.value).toBe('');
  expect(api.connectSsh).toHaveBeenCalledWith(
    { sshHost: 'my-server', password: 'temporary-test-password', savePassword: false },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭服务器' }));
  expect(f.close).toHaveBeenCalled();
  f.unmount();
  await act(async () => finish({ ...status, connected: true, hasPassword: true, authMode: 'password' }));
  const reopened = mount();
  expect((await screen.findByLabelText<HTMLInputElement>('SSH 密码')).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '使用此服务器' }));
  expect(reopened.onSelect).toHaveBeenCalledWith(server.alias);
});
it('新增档案明确保存认证方式，保存后可以选择，不把密码写入档案', async () => {
  vi.spyOn(api, 'saveSshTarget').mockResolvedValue({
    ...server,
    alias: 'new-server',
    name: '新服务器',
    authMode: 'key',
  });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '新增服务器' }));
  fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '新服务器' } });
  fireEvent.change(screen.getByLabelText('地址'), { target: { value: 'my-server' } });
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'user' } });
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await waitFor(() =>
    expect(api.saveSshTarget).toHaveBeenCalledWith(
      expect.objectContaining({ authMode: 'key', name: '新服务器' }),
      expect.any(AbortSignal),
    ),
  );
  expect(vi.mocked(api.saveSshTarget).mock.calls[0]?.[0]).not.toHaveProperty('password');
});
it('切换档案中止在途认证，迟到响应不改新目标或清除新输入', async () => {
  const other = { ...server, alias: 'other-server', name: '另一服务器' };
  vi.mocked(api.listSshHosts).mockResolvedValue([server, other]);
  let finish!: (result: Awaited<ReturnType<typeof api.connectSsh>>) => void;
  vi.spyOn(api, 'connectSsh').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const f = mount();
  const old = await screen.findByLabelText<HTMLInputElement>('SSH 密码');
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '保存密码' }).disabled).toBe(false),
  );
  fireEvent.change(old, { target: { value: 'old-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  const signal = vi.mocked(api.connectSsh).mock.calls[0]![1]!;
  fireEvent.click(screen.getByRole('button', { name: `选择服务器：${other.name}` }));
  expect(signal.aborted).toBe(true);
  expect(old.value).toBe('');
  const current = screen.getByLabelText<HTMLInputElement>('SSH 密码');
  fireEvent.change(current, { target: { value: 'new-secret' } });
  await act(async () => finish({ ...status, connected: true, authMode: 'password', hasPassword: true }));
  expect(current.value).toBe('new-secret');
  expect(screen.queryByText('服务器已连接')).toBeNull();
  expect(f.client.getQueryData(['ssh-credentials', other.alias])).not.toMatchObject({ connected: true });
});
it('引用中的身份字段不可修改，编辑携带旧快照，409保留草稿', async () => {
  vi.spyOn(api, 'saveSshTargetEdit').mockRejectedValue(new Error('档案已变化'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑服务器' }));
  expect(screen.getByLabelText<HTMLInputElement>('地址').disabled).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>('账号').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '重命名' } });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存服务器' }).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText<HTMLInputElement>('连接名称').value).toBe('重命名');
  expect(api.saveSshTargetEdit).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ name: '重命名', authMode: 'password' }),
      expected: server,
      revision: 'a'.repeat(64),
    }),
    expect.any(AbortSignal),
  );
});
it('删除必须明确确认，携带档案快照，成功移除选项', async () => {
  vi.mocked(api.listWorkspaces).mockResolvedValue([]);
  vi.spyOn(api, 'deleteSshTarget').mockResolvedValue(undefined);
  mount();
  const remove = await screen.findByRole<HTMLButtonElement>('button', { name: '删除服务器' });
  await waitFor(() => expect(remove.disabled).toBe(false));
  fireEvent.click(remove);
  const confirm = screen.getByRole<HTMLButtonElement>('button', { name: '确认删除服务器' });
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认删除此服务器档案' }));
  vi.mocked(api.listSshHosts).mockResolvedValue([]);
  fireEvent.click(confirm);
  await waitFor(() => expect(api.deleteSshTarget).toHaveBeenCalledWith(server, expect.any(AbortSignal)));
  await screen.findByText('暂无服务器，可新增或导入');
});
it('SSH配置仅填表，不支持的选项不可导入，明确保存才登记档案', async () => {
  vi.spyOn(api, 'sshImportOptions').mockResolvedValue([
    { alias: 'config-server', hostname: 'my-server', user: 'user', keyFile: '~/.ssh/id_demo', unsupported: [] },
    { alias: 'jump-server', unsupported: ['ProxyJump'] },
  ]);
  vi.spyOn(api, 'saveSshTarget').mockResolvedValue({ ...server, authMode: 'key' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '从 SSH 配置导入' }));
  const buttons = await screen.findAllByRole<HTMLButtonElement>('button', { name: '填入表单' });
  expect(buttons[1]!.disabled).toBe(true);
  fireEvent.click(buttons[0]!);
  expect(screen.getByLabelText<HTMLInputElement>('私钥文件路径（可选）').value).toBe('~/.ssh/id_demo');
  expect(api.saveSshTarget).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await waitFor(() =>
    expect(api.saveSshTarget).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'config-server', keyFile: '~/.ssh/id_demo', authMode: 'key' }),
      expect.any(AbortSignal),
    ),
  );
});
it('向导只选择档案，不出现认证表单；打开同一管理入口后关闭保留选择', async () => {
  function Wizard() {
    const [input, setInput] = useState({ name: '草稿', localDir: 'demo', sshHost: server.alias, remoteDir: '~/demo' });
    return <ServerStep input={input} change={(patch) => setInput((value) => ({ ...value, ...patch }))} />;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <Wizard />
    </QueryClientProvider>,
  );
  await screen.findByRole('option', { name: /演示服务器/ });
  expect(screen.queryByLabelText('SSH 密码')).toBeNull();
  expect(screen.queryByLabelText('认证方式')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '管理服务器' }));
  const password = await screen.findByLabelText<HTMLInputElement>('SSH 密码');
  fireEvent.change(password, { target: { value: 'discard-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '关闭服务器' }));
  expect(password.value).toBe('');
  expect(screen.getByLabelText<HTMLSelectElement>('服务器').value).toBe(server.alias);
});
it('保存成功取消旧列表GET，迟到快照不能回退服务器档案', async () => {
  const updated = { ...server, name: '已更新服务器' };
  vi.spyOn(api, 'saveSshTargetEdit').mockResolvedValue(updated);
  const f = mount();
  fireEvent.click(await screen.findByRole('button', { name: '编辑服务器' }));
  let resolve!: (value: ManagedServer[]) => void;
  const late = new Promise<ManagedServer[]>((done) => {
    resolve = done;
  });
  vi.mocked(api.listSshHosts).mockReturnValue(late);
  let pending!: Promise<void>;
  act(() => {
    pending = f.client.invalidateQueries({ queryKey: ['ssh-targets'] });
  });
  fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: updated.name } });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存服务器' }).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await waitFor(() => expect(f.client.getQueryData<ManagedServer[]>(['ssh-targets'])?.[0]?.name).toBe(updated.name));
  await act(async () => {
    resolve([server]);
    await pending;
  });
  expect(f.client.getQueryData<ManagedServer[]>(['ssh-targets'])?.[0]?.name).toBe(updated.name);
});
it.each([true, false])('复用服务器密码并按服务器断开，保存状态为%s', async (saved) => {
  vi.mocked(api.sshCredentials).mockResolvedValue({ ...status, connected: true, hasPassword: true, saved });
  vi.spyOn(api, 'connectSsh').mockResolvedValue({
    ...status,
    connected: true,
    hasPassword: true,
    saved,
    authMode: 'password',
  });
  vi.spyOn(api, 'clearSavedSshPassword').mockResolvedValue({ ...status, paused: true });
  vi.spyOn(api, 'disconnectSsh').mockResolvedValue(undefined);
  const f = mount();
  const saving = await screen.findByRole<HTMLInputElement>('checkbox', { name: '保存密码' });
  await waitFor(() => expect(saving.disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  await waitFor(() =>
    expect(api.connectSsh).toHaveBeenCalledWith(
      { sshHost: server.alias, password: undefined, savePassword: undefined },
      expect.any(AbortSignal),
    ),
  );
  await waitFor(() => expect(saving.disabled).toBe(false));
  vi.mocked(api.sshCredentials).mockResolvedValue({ ...status, paused: true });
  fireEvent.click(saved ? saving : screen.getByRole('button', { name: '断开服务器' }));
  await waitFor(() =>
    expect(saved ? api.clearSavedSshPassword : api.disconnectSsh).toHaveBeenCalledWith(
      server.alias,
      expect.any(AbortSignal),
    ),
  );
  await screen.findByText('SSH 已断开，自动连接已暂停');
  expect(f.client.getQueryData(['ssh-credentials', server.alias])).toMatchObject({ connected: false, saved: false });
});
it('新增密码档案可不保存密码，再从独立连接入口输入；连接后留空复用不再发送保存偏好', async () => {
  const added = { ...server, alias: 'new-server', name: '新密码服务器' };
  vi.spyOn(api, 'saveSshTarget').mockResolvedValue(added);
  vi.spyOn(api, 'connectSsh').mockResolvedValue({
    ...status,
    connected: true,
    hasPassword: true,
    authMode: 'password',
  });
  vi.spyOn(api, 'disconnectSsh').mockResolvedValue(undefined);
  const f = mount();
  fireEvent.click(screen.getByRole('button', { name: '新增服务器' }));
  fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: added.name } });
  fireEvent.change(screen.getByLabelText('地址'), { target: { value: added.hostname } });
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: added.username } });
  fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'password' } });
  expect(screen.getByLabelText<HTMLInputElement>('SSH 密码').value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  const connectionForm = await screen.findByRole('form', { name: '连接服务器' });
  const password = within(connectionForm).getByLabelText<HTMLInputElement>('SSH 密码');
  await waitFor(() => expect(document.activeElement).toBe(password));
  expect(screen.getByText(/已保存.*新密码服务器/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择服务器：新密码服务器' }).getAttribute('aria-pressed')).toBe('true');
  expect(vi.mocked(api.saveSshTarget).mock.calls[0]?.[0]).not.toHaveProperty('password');
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '保存密码' }).disabled).toBe(false),
  );
  fireEvent.change(password, { target: { value: 'new-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  expect(password.value).toBe('');
  await screen.findByText('服务器已连接');
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  await waitFor(() => expect(api.connectSsh).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.connectSsh).mock.calls[1]?.[0]).toEqual({
    sshHost: 'new-server',
    password: undefined,
    savePassword: undefined,
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭服务器' }));
  f.unmount();
  expect(api.disconnectSsh).not.toHaveBeenCalled();
});

it('紧凑列表同时显示名称、目标、认证状态和引用；选择只展示详情，不连接、断开或进入编辑', async () => {
  const other: ManagedServer = {
    ...server,
    alias: 'other-server',
    name: '另一服务器',
    hostname: 'other-server',
    authMode: 'key',
  };
  vi.mocked(api.listSshHosts).mockResolvedValue([server, other]);
  vi.mocked(api.sshCredentials).mockImplementation(async (alias) => ({ ...status, connected: alias === other.alias }));
  const connect = vi.spyOn(api, 'connectSsh');
  const disconnect = vi.spyOn(api, 'disconnectSsh');
  const f = mount(vi.fn(), '');
  const list = await screen.findByRole('list', { name: '服务器列表' });
  const first = within(list).getByRole('button', { name: '选择服务器：演示服务器' });
  const second = within(list).getByRole('button', { name: '选择服务器：另一服务器' });
  expect(within(first).getByText('user@my-server:22')).toBeTruthy();
  expect(within(first).getByText('账号密码')).toBeTruthy();
  expect(await within(first).findByText('需输入密码')).toBeTruthy();
  expect(within(first).getByText('1 个工作区引用')).toBeTruthy();
  expect(within(second).getByText('user@other-server:22')).toBeTruthy();
  expect(within(second).getByText('已有私钥')).toBeTruthy();
  expect(await within(second).findByText('已连接')).toBeTruthy();
  expect(within(second).getByText('无工作区引用')).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: '已保存服务器' })).toBeNull();
  expect(screen.queryByLabelText('SSH 密码')).toBeNull();
  fireEvent.click(first);
  expect(first.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('region', { name: '所选服务器详情' })).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除服务器' }).disabled).toBe(true);
  expect(screen.queryByLabelText('连接名称')).toBeNull();
  const password = await screen.findByLabelText<HTMLInputElement>('SSH 密码');
  fireEvent.change(password, { target: { value: 'discard-on-selection' } });
  fireEvent.click(second);
  expect(second.getAttribute('aria-pressed')).toBe('true');
  expect(first.getAttribute('aria-pressed')).toBe('false');
  expect(password.value).toBe('');
  expect(screen.queryByLabelText('连接名称')).toBeNull();
  expect(connect).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
  expect(f.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '编辑服务器' }));
  expect(screen.getByLabelText<HTMLInputElement>('连接名称').value).toBe(other.name);
  expect(screen.getByLabelText<HTMLInputElement>('地址').disabled).toBe(false);
});

it('列表状态或引用读取失败不伪装未连接或无引用，保留目标并阻止危险编辑', async () => {
  vi.mocked(api.sshCredentials).mockRejectedValue(new Error('状态不可用'));
  vi.mocked(api.listWorkspaces).mockRejectedValue(new Error('引用不可用'));
  mount();
  const item = await screen.findByRole('button', { name: '选择服务器：演示服务器' });
  expect(await within(item).findByText('状态读取失败')).toBeTruthy();
  expect(within(item).getByText('引用读取失败')).toBeTruthy();
  expect(within(item).queryByText('无工作区引用')).toBeNull();
  expect(within(item).queryByText('未连接')).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '删除服务器' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '编辑服务器' }));
  expect(screen.getByLabelText<HTMLInputElement>('地址').disabled).toBe(true);
});

it('活动任务拒绝删除时保留服务器列表与原快照，不伪报删除成功', async () => {
  vi.mocked(api.listWorkspaces).mockResolvedValue([]);
  vi.spyOn(api, 'deleteSshTarget').mockRejectedValue(new ApiError(409, '服务器存在活动任务'));
  const f = mount();
  const remove = await screen.findByRole<HTMLButtonElement>('button', { name: '删除服务器' });
  await waitFor(() => expect(remove.disabled).toBe(false));
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认删除此服务器档案' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除服务器' }));
  expect((await screen.findByRole('alert')).textContent).toContain('服务器存在活动任务');
  expect(api.deleteSshTarget).toHaveBeenCalledWith(server, expect.any(AbortSignal));
  expect(screen.getByRole('button', { name: '选择服务器：演示服务器' }).getAttribute('aria-pressed')).toBe('true');
  expect(f.client.getQueryData(['ssh-targets'])).toEqual([server]);
  expect(f.close).not.toHaveBeenCalled();
});

it('主机指纹必须显式检查和确认，切换列表清理旧挑战与密码，不触发认证', async () => {
  const other = { ...server, alias: 'other-server', name: '另一服务器' };
  vi.mocked(api.listSshHosts).mockResolvedValue([server, other]);
  const probe: HostTrustStatus = {
    status: 'unknown',
    alias: server.alias,
    target: { hostname: server.hostname, port: server.port, username: server.username },
    algorithm: 'ssh-ed25519',
    fingerprint: `SHA256:${'A'.repeat(43)}`,
    challenge: '11111111-1111-4111-8111-111111111111',
  };
  vi.spyOn(api, 'probeHostKey').mockResolvedValue(probe);
  vi.spyOn(api, 'confirmHostKey').mockResolvedValue({ ...probe, status: 'trusted' });
  vi.spyOn(api, 'connectSsh');
  mount();
  const password = await screen.findByLabelText<HTMLInputElement>('SSH 密码');
  expect(api.probeHostKey).not.toHaveBeenCalled();
  fireEvent.change(password, { target: { value: 'discard-before-probe' } });
  fireEvent.click(screen.getByRole('button', { name: '检查实际指纹' }));
  await screen.findByText(probe.fingerprint);
  expect(password.value).toBe('');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '信任此公钥' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '我已核对本次实际指纹' }));
  fireEvent.click(screen.getByRole('button', { name: '选择服务器：另一服务器' }));
  expect(screen.queryByText(probe.fingerprint)).toBeNull();
  expect(screen.queryByRole('button', { name: '信任此公钥' })).toBeNull();
  expect(api.confirmHostKey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选择服务器：演示服务器' }));
  fireEvent.click(screen.getByRole('button', { name: '检查实际指纹' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '我已核对本次实际指纹' }));
  fireEvent.click(screen.getByRole('button', { name: '信任此公钥' }));
  await screen.findByText('实际公钥与本机信任记录一致，可以继续测试认证。');
  expect(api.confirmHostKey).toHaveBeenCalledWith(
    { challenge: probe.challenge, fingerprint: probe.fingerprint, confirmed: true },
    expect.any(AbortSignal),
  );
  expect(api.connectSsh).not.toHaveBeenCalled();
});
function mountManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const close = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ServerManagerDialog onClose={close} />
    </QueryClientProvider>,
  );
  return { ...view, close, client };
}

it('管理入口点击服务器行直接编辑；向导选择服务器仍先看详情再用', async () => {
  const manager = mountManager();
  expect(await screen.findByText('选择一台服务器直接编辑，或新增服务器。')).toBeTruthy();
  expect(screen.queryByLabelText('连接名称')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '编辑服务器：演示服务器' }));
  expect(screen.getByLabelText<HTMLInputElement>('连接名称').value).toBe(server.name);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存服务器' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: '所选服务器详情' })).toBeNull();
  manager.unmount();

  mount(vi.fn(), '');
  const picker = await screen.findByRole('button', { name: '选择服务器：演示服务器' });
  fireEvent.click(picker);
  expect(screen.getByRole('region', { name: '所选服务器详情' })).toBeTruthy();
  expect(screen.queryByLabelText('连接名称')).toBeNull();
  expect(screen.getByRole('button', { name: '使用此服务器' })).toBeTruthy();
});
