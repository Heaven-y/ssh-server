// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ManagedServer } from '@ssh-server/shared';
import { api } from '../../../src/lib/api';
import { ServerManagerDialog } from '../../../src/features/ssh/ServerManagerDialog';

const server: ManagedServer = {
  alias: 'my-server',
  name: '合成服务器',
  hostname: 'example.invalid',
  username: 'demo',
  port: 22,
  authMode: 'password',
};
const other: ManagedServer = { ...server, alias: 'other-server', name: '另一合成服务器', hostname: 'other.invalid' };
const status = { saved: true, savingAvailable: true, connected: false, paused: false, hasPassword: false };
const revision = 'a'.repeat(64);
const clients: QueryClient[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>打开服务器管理</button>
        {open && <ServerManagerDialog initialAlias={server.alias} onClose={() => setOpen(false)} />}
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  return client;
}
function requests(method: string) {
  return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === method);
}
async function openEditor() {
  fireEvent.click(await screen.findByRole('button', { name: '编辑服务器' }));
  return screen.findByLabelText<HTMLInputElement>('SSH 密码');
}
async function loadedEditor() {
  const field = await openEditor();
  await waitFor(() => expect(field.value).toBe('fixture-existing-secret'));
  return field;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server, other]);
  vi.spyOn(api, 'listWorkspaces').mockResolvedValue([]);
  vi.spyOn(api, 'sshCredentials').mockResolvedValue(status);
  vi.spyOn(api, 'connectSsh').mockRejectedValue(new Error('编辑不得连接'));
  vi.spyOn(api, 'probeHostKey').mockRejectedValue(new Error('编辑不得探测'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/password/read'))
        return json({
          password: url.includes(other.alias) ? 'fixture-other-secret' : 'fixture-existing-secret',
          revision,
          savingAvailable: true,
        });
      const body = JSON.parse(init?.body as string) as {
        expected?: ManagedServer;
        input: Omit<ManagedServer, 'alias'>;
      };
      return json({ ...body.input, alias: body.expected?.alias ?? 'added-server' });
    }),
  );
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('只有明确打开编辑才按需读取实际密码，默认掩码并可用眼睛查看与隐藏', async () => {
  const client = mount();
  await screen.findByRole('button', { name: '编辑服务器' });
  expect(fetch).not.toHaveBeenCalled();
  const field = await loadedEditor();
  expect(field.type).toBe('password');
  expect(field.placeholder).not.toContain('留空');
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  expect(url).toBe('/api/ssh-targets/my-server/password/read');
  expect(options).toMatchObject({ method: 'POST', cache: 'no-store', signal: expect.any(AbortSignal) });
  expect(JSON.parse(options!.body as string)).toEqual({ expected: server });
  fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  expect(field.type).toBe('text');
  expect(field.value).toBe('fixture-existing-secret');
  fireEvent.click(screen.getByRole('button', { name: '隐藏密码' }));
  expect(field.type).toBe('password');
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('fixture-existing-secret');
  expect(JSON.stringify(localStorage)).not.toContain('fixture-existing-secret');
  expect(location.href).not.toContain('fixture-existing-secret');
});

it('密码可编辑但仅确认保存才替换，发送清理，不把保存当作认证成功', async () => {
  mount();
  const field = await loadedEditor();
  fireEvent.change(field, { target: { value: 'fixture-replacement-secret' } });
  expect(requests('PUT')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  expect(field.value).toBe('');
  await waitFor(() => expect(requests('PUT')).toHaveLength(1));
  const [url, options] = requests('PUT')[0]!;
  expect(url).toBe('/api/ssh-targets/my-server/password');
  expect(options).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) });
  expect(JSON.parse(options!.body as string)).toMatchObject({
    expected: server,
    revision,
    password: 'fixture-replacement-secret',
    confirmed: true,
  });
  await screen.findByRole('button', { name: '编辑服务器' });
  expect(screen.queryByText('服务器已连接')).toBeNull();
  expect(screen.getByText(/保存不代表认证成功/)).toBeTruthy();
  expect(api.connectSsh).not.toHaveBeenCalled();
  expect(api.probeHostKey).not.toHaveBeenCalled();
});

it.each(['取消编辑', '关闭服务器', '编辑服务器：另一合成服务器'])(
  '%s立即清空已回显字段，退出不保存',
  async (action) => {
    mount();
    const field = await loadedEditor();
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(field.value).toBe('');
    expect(requests('PUT')).toHaveLength(0);
    expect(screen.queryByDisplayValue('fixture-existing-secret')).toBeNull();
  },
);

it.each(['关闭服务器', '编辑服务器：另一合成服务器'])(
  '%s中止读取，迟到密码不会覆盖重新打开的编辑器',
  async (action) => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          finish = done;
        }),
    );
    mount();
    const old = await openEditor();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(signal.aborted).toBe(true);
    if (action === '关闭服务器') fireEvent.click(screen.getByRole('button', { name: '打开服务器管理' }));
    // 管理入口点击服务器行直接进入编辑表单；关闭后重开先落在详情，需再显式进入编辑。
    const current =
      action === '关闭服务器' ? await openEditor() : await screen.findByLabelText<HTMLInputElement>('SSH 密码');
    await waitFor(() =>
      expect(current.value).toBe(action === '关闭服务器' ? 'fixture-existing-secret' : 'fixture-other-secret'),
    );
    fireEvent.change(current, { target: { value: 'fixture-current-draft' } });
    await act(async () => finish(json({ password: 'fixture-late-secret', revision, savingAvailable: true })));
    expect(old.value).toBe('');
    expect(current.value).toBe('fixture-current-draft');
    expect(current.type).toBe('password');
  },
);

it.each(['地址', '账号', '端口', '认证方式'])('改变%s同步抹除旧密码与可见状态，不暗中存入新目标', async (label) => {
  mount();
  const field = await loadedEditor();
  fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  const value = { 地址: 'new.invalid', 账号: 'new-demo', 端口: 2222, 认证方式: 'key' }[label];
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  expect(field.value).toBe('');
  if (label !== '认证方式') {
    expect(field.type).toBe('password');
    expect(screen.getByText(/目标已改变.*重新输入/)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await waitFor(() => expect(requests('PUT')).toHaveLength(1));
  expect(requests('PUT')[0]![1]!.body).not.toContain('fixture-existing-secret');
});

it('读取尚未返回就改变目标，保留原快照的revision但不迟到回填旧密码', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        finish = done;
      }),
  );
  mount();
  const field = await openEditor();
  fireEvent.change(screen.getByLabelText('地址'), { target: { value: 'new.invalid' } });
  await act(async () => finish(json({ password: 'fixture-late-secret', revision, savingAvailable: true })));
  expect(field.value).toBe('');
  expect(field.type).toBe('password');
  fireEvent.change(field, { target: { value: 'fixture-explicit-new-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await waitFor(() => expect(requests('PUT')).toHaveLength(1));
  expect(JSON.parse(requests('PUT')[0]![1]!.body as string)).toMatchObject({
    expected: server,
    input: { hostname: 'new.invalid' },
    revision,
    password: 'fixture-explicit-new-secret',
  });
});

it('新服务器在编辑表单设置密码，确认保存不经过普通档案或连接接口', async () => {
  vi.spyOn(api, 'saveSshTarget');
  mount();
  fireEvent.click(screen.getByRole('button', { name: '新增服务器' }));
  fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '新增合成服务器' } });
  fireEvent.change(screen.getByLabelText('地址'), { target: { value: 'new.invalid' } });
  fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'demo' } });
  fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'password' } });
  const field = screen.getByLabelText<HTMLInputElement>('SSH 密码');
  expect(field.type).toBe('password');
  fireEvent.change(field, { target: { value: 'fixture-new-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  expect(field.value).toBe('');
  await screen.findByRole('button', { name: '编辑服务器：新增合成服务器' });
  expect(requests('POST')).toHaveLength(1);
  expect(requests('POST')[0]![0]).toBe('/api/ssh-targets/with-password');
  expect(JSON.parse(requests('POST')[0]![1]!.body as string)).toMatchObject({
    password: 'fixture-new-secret',
    confirmed: true,
    input: { hostname: 'new.invalid', authMode: 'password' },
  });
  expect(api.saveSshTarget).not.toHaveBeenCalled();
  expect(api.connectSsh).not.toHaveBeenCalled();
});

it('密码加载失败不能以空白覆盖保存项，错误可见且保留档案草稿', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 'credential_storage_failed', message: '本机加密读取失败' }), { status: 409 }),
  );
  mount();
  await openEditor();
  expect((await screen.findByRole('alert')).textContent).toContain('本机加密读取失败');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存服务器' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: '保留草稿' } });
  expect(screen.getByLabelText<HTMLInputElement>('连接名称').value).toBe('保留草稿');
  expect(requests('PUT')).toHaveLength(0);
});

it.each(['新增服务器', '从 SSH 配置导入'])('%s清除旧列表选择，不把新档案编辑误标为原服务器', async (action) => {
  vi.spyOn(api, 'sshImportOptions').mockResolvedValue([]);
  mount();
  const selected = await screen.findByRole('button', { name: '编辑服务器：合成服务器' });
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: action }));
  expect(selected.getAttribute('aria-pressed')).toBe('false');
  expect(fetch).not.toHaveBeenCalled();
});

it('保存成功立即撤销旧连接状态，状态重读未返回时不能冒充新身份已认证', async () => {
  vi.mocked(api.sshCredentials).mockResolvedValue({ ...status, connected: true, hasPassword: true });
  const client = mount();
  const field = await loadedEditor();
  let finish!: (value: typeof status) => void;
  const pending = new Promise<typeof status>((resolve) => {
    finish = resolve;
  });
  vi.mocked(api.sshCredentials).mockReturnValue(pending);
  fireEvent.change(field, { target: { value: 'fixture-new-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  try {
    await screen.findByRole('button', { name: '编辑服务器' });
    expect(client.getQueryData<typeof status>(['ssh-credentials', server.alias])?.connected).not.toBe(true);
    expect(screen.queryByText('服务器已连接')).toBeNull();
    expect(api.connectSsh).not.toHaveBeenCalled();
  } finally {
    await act(async () => finish({ ...status, paused: true }));
  }
});

it('认证方式切回后保存失败重读，空密码重试仍明确清除', async () => {
  mount();
  await loadedEditor();
  fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'key' } });
  fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'password' } });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 'target_busy', message: '目标有活动，请稍后重试' }), { status: 409 }),
  );
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  expect((await screen.findByRole('alert')).textContent).toContain('目标有活动');
  expect(JSON.parse(requests('PUT')[0]![1]!.body as string).password).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新读取编辑信息' }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存服务器' }).disabled).toBe(false),
  );
  expect(screen.getByLabelText<HTMLInputElement>('SSH 密码').value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '保存服务器' }));
  await waitFor(() => expect(requests('PUT')).toHaveLength(2));
  expect(JSON.parse(requests('PUT')[1]![1]!.body as string).password).toBeNull();
  expect(api.connectSsh).not.toHaveBeenCalled();
});
