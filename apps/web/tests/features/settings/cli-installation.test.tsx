// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallationStatus } from '@agentdeck/shared/settings';
import { CliInstallationPanel } from '../../../src/features/settings/CliInstallationPanel';
import { useChat } from '../../../src/features/chat/chat-store';
import { nativeCapabilitiesGeneration } from '../../../src/cli/shared/capability-cache';

const initial: CliInstallationStatus = {
  agent: 'claude',
  installed: true,
  currentVersion: '1.0.0',
  latestVersion: null,
  source: 'npm',
  updateAvailable: false,
  canInstall: false,
  canUpdate: true,
  checkedAt: null,
  revision: 'a'.repeat(64),
  phase: 'idle',
  operationId: null,
  message: null,
  guideUrl: 'https://code.claude.com/docs/en/setup',
};
const newer = { ...initial, latestVersion: '2.0.0', checkedAt: 1, updateAvailable: true };
const missing: CliInstallationStatus = {
  ...initial,
  installed: false,
  currentVersion: null,
  source: 'missing',
  canInstall: true,
  canUpdate: false,
};
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(agent: AgentKind = 'claude') {
  return render(
    <QueryClientProvider client={client}>
      <CliInstallationPanel agent={agent} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(initial));
  vi.stubGlobal('fetch', fetchMock);
  useChat.setState({ agent: 'claude', running: false, pendingClientTurnId: undefined, background: {} });
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('只显式检查官方新版，等待期间禁止重复检查，有新版才允许更新', async () => {
  const check = deferred<Response>();
  fetchMock.mockImplementation(async (_url, options) => (options?.method === 'POST' ? check.promise : json(initial)));
  mount();
  await screen.findByText('1.0.0');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('已是最新版本')).toBeNull();
  expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
  const button = screen.getByRole('button', { name: '检查更新' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1]).toEqual([
    '/api/settings/cli-installation/claude/check',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  ]);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在检查…' }).disabled).toBe(true);
  await act(async () => check.resolve(json(newer)));
  await screen.findByText('2.0.0');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '更新' }).disabled).toBe(false);
});

it('点击安装先检查并使用新revision提交，关闭再打开恢复任务，成功后刷新缓存且停止轮询', async () => {
  const checked = { ...missing, latestVersion: '2.0.0', checkedAt: 2, revision: 'b'.repeat(64) };
  const pending = { ...initial, installed: false, phase: 'installing', operationId: 'operation-1', message: null };
  const done = {
    ...initial,
    phase: 'succeeded',
    operationId: 'operation-1',
    message: '安装完成',
    currentVersion: '2.0.0',
  };
  const operation = deferred<Response>();
  const check = deferred<Response>();
  let current: unknown = missing;
  fetchMock.mockImplementation(async (url, options) => {
    if (options?.method !== 'POST') return json(current);
    return typeof url === 'string' && url.endsWith('/check') ? check.promise : operation.promise;
  });
  client.setQueryData(['environment'], { checkedAt: 1 });
  client.setQueryData(['agent-capabilities', 'demo', 'claude'], { models: [] });
  client.setQueryData(['session-tools', 'claude'], { enabled: true });
  const generation = nativeCapabilitiesGeneration('claude');
  const first = mount();
  const install = await screen.findByRole('button', { name: '安装' });
  fireEvent.click(install);
  fireEvent.click(install);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1]).toEqual([
    '/api/settings/cli-installation/claude/check',
    expect.objectContaining({ method: 'POST', body: '{}' }),
  ]);
  expect(screen.getByText('正在准备安装…')).toBeTruthy();
  await act(async () => check.resolve(json(checked)));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(fetchMock.mock.calls[2]).toEqual([
    '/api/settings/cli-installation/claude/operations',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'install', revision: checked.revision }),
    }),
  ]);
  first.unmount();
  current = pending;
  await act(async () => operation.resolve(json(pending, 202)));
  const second = mount();
  await screen.findByText('正在安装…');
  current = { ...pending, phase: 'verifying' };
  await screen.findByText('正在验证安装结果…', {}, { timeout: 2500 });
  second.unmount();
  current = done;
  await waitFor(() => expect(client.getQueryState(['environment'])?.isInvalidated).toBe(true), { timeout: 2500 });
  expect(client.getQueryData(['cli-installation', 'claude'])).toMatchObject({
    phase: 'succeeded',
    currentVersion: '2.0.0',
  });
  expect(client.getQueryData(['agent-capabilities', 'demo', 'claude'])).toBeUndefined();
  expect(client.getQueryState(['session-tools', 'claude'])?.isInvalidated).toBe(true);
  expect(nativeCapabilitiesGeneration('claude')).toBe(generation + 1);
  const reads = fetchMock.mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1150));
  });
  expect(fetchMock).toHaveBeenCalledTimes(reads);
  mount();
  await screen.findByText('安装完成');
  expect(nativeCapabilitiesGeneration('claude')).toBe(generation + 1);
});

it('安装部分改变文件后失败也刷新环境和能力，普通查新失败不刷新', async () => {
  client.setQueryData(['environment'], { checkedAt: 1 });
  client.setQueryData(['agent-capabilities', 'demo', 'claude'], { models: [] });
  client.setQueryData(['session-tools', 'claude'], { enabled: true });
  const generation = nativeCapabilitiesGeneration('claude');
  fetchMock.mockResolvedValueOnce(json({ ...newer, phase: 'failed', operationId: null, message: '检查新版失败。' }));
  const first = mount();
  await screen.findByText('检查新版失败。');
  expect(client.getQueryState(['environment'])?.isInvalidated).toBe(false);
  expect(nativeCapabilitiesGeneration('claude')).toBe(generation);
  first.unmount();
  fetchMock.mockResolvedValue(
    json({ ...newer, phase: 'failed', operationId: 'partial-change', message: '安装后的兼容性检查未通过。' }),
  );
  mount();
  await screen.findByText('安装后的兼容性检查未通过。');
  await waitFor(() => expect(client.getQueryState(['environment'])?.isInvalidated).toBe(true));
  expect(client.getQueryData(['agent-capabilities', 'demo', 'claude'])).toBeUndefined();
  expect(client.getQueryState(['session-tools', 'claude'])?.isInvalidated).toBe(true);
  expect(nativeCapabilitiesGeneration('claude')).toBe(generation + 1);
});

it('后台状态读取失败后停止重试，重新打开恢复任务，重复卡片共享GET', async () => {
  const pending = { ...newer, phase: 'updating', operationId: 'background-update' };
  fetchMock.mockResolvedValueOnce(json(pending)).mockRejectedValueOnce(new Error('synthetic-network-failure'));
  const first = mount();
  await screen.findByText('正在更新…');
  first.unmount();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2500 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1150));
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  let current = pending;
  fetchMock.mockImplementation(async () => json(current));
  const restored = render(
    <QueryClientProvider client={client}>
      <CliInstallationPanel agent="claude" />
      <CliInstallationPanel agent="claude" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getAllByText('正在更新…')).toHaveLength(2));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  restored.unmount();
  current = { ...pending, phase: 'succeeded' };
  await waitFor(
    () => expect(client.getQueryData<CliInstallationStatus>(['cli-installation', 'claude'])?.phase).toBe('succeeded'),
    { timeout: 2500 },
  );
  expect(fetchMock).toHaveBeenCalledTimes(4);
}, 7000);

it('后台跟踪超过十分钟会释放读取，重新打开仍可恢复结果', async () => {
  vi.useFakeTimers();
  const pending = { ...newer, phase: 'updating', operationId: 'slow-update' };
  let readSignal: AbortSignal | undefined;
  fetchMock.mockResolvedValueOnce(json(pending)).mockImplementation(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        readSignal = options?.signal ?? undefined;
        readSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
  );
  const first = mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText('正在更新…')).toBeTruthy();
  first.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(601000);
  });
  expect(readSignal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockImplementation(async () => json({ ...pending, phase: 'succeeded', message: '更新完成。' }));
  mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText('更新完成。')).toBeTruthy();
});

it('网络错误后手动重试返回相同进度，也能恢复后台跟踪直到完成', async () => {
  const pending = { ...newer, phase: 'updating', operationId: 'retry-same-state' };
  fetchMock.mockResolvedValueOnce(json(pending)).mockRejectedValueOnce(new Error('synthetic-network-failure'));
  client.setQueryData(['environment'], { checkedAt: 1 });
  mount();
  await screen.findByRole('alert', {}, { timeout: 2500 });
  fetchMock.mockImplementation(async () => json(pending));
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  fetchMock.mockImplementation(async () => json({ ...pending, phase: 'succeeded', message: '重试后完成。' }));
  await screen.findByText('重试后完成。', {}, { timeout: 2500 });
  expect(client.getQueryState(['environment'])?.isInvalidated).toBe(true);
});

it.each([
  { name: '查询请求失败', body: { message: 'synthetic-private-detail' }, code: 502, message: /暂时无法读取或操作 CLI/ },
  {
    name: '检查返回失败状态',
    body: { ...missing, phase: 'failed', message: '未能读取官方版本。' },
    code: 200,
    message: /未能读取官方版本/,
  },
  {
    name: '检查后不可安装',
    body: { ...missing, canInstall: false, message: '当前安装来源不支持安装。' },
    code: 200,
    message: /当前安装来源不支持安装/,
  },
])('准备安装时 $name 不会提交安装操作', async ({ body, code, message }) => {
  fetchMock.mockResolvedValueOnce(json(missing)).mockResolvedValueOnce(json(body, code));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '安装' }));
  await screen.findByText(message);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    '/api/settings/cli-installation/claude',
    '/api/settings/cli-installation/claude/check',
  ]);
  expect(screen.queryByText(/synthetic-private-detail/)).toBeNull();
});

it('切换CLI后迟到的检查结果只回填原CLI，不能覆盖新面板', async () => {
  const check = deferred<Response>();
  fetchMock.mockImplementation(async (url, options) => {
    if (options?.method === 'POST') return check.promise;
    return json(
      typeof url === 'string' && url.endsWith('/codex')
        ? { ...initial, agent: 'codex', currentVersion: '3.0.0' }
        : initial,
    );
  });
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: '检查更新' }));
  view.rerender(
    <QueryClientProvider client={client}>
      <CliInstallationPanel agent="codex" />
    </QueryClientProvider>,
  );
  await screen.findByText('3.0.0');
  await act(async () => check.resolve(json(newer)));
  expect(screen.queryByText('2.0.0')).toBeNull();
  expect(screen.getByRole('region', { name: 'Codex 安装与更新' })).toBeTruthy();
  view.rerender(
    <QueryClientProvider client={client}>
      <CliInstallationPanel agent="claude" />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: '检查更新' });
  expect(screen.queryByText('3.0.0')).toBeNull();
});

it('请求失败隐藏外部错误原文，服务端失败状态不会显示已最新并允许重新检查', async () => {
  fetchMock.mockResolvedValueOnce(json(newer)).mockResolvedValueOnce(json({ message: 'synthetic-secret-output' }, 500));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '更新' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(/synthetic-secret-output/)).toBeNull();
  fetchMock.mockResolvedValue(
    json({ ...initial, latestVersion: '1.0.0', checkedAt: 1, phase: 'failed', message: '版本检查失败，请稍后重试。' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
  await screen.findByText('版本检查失败，请稍后重试。');
  expect(screen.queryByText('已是最新版本')).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '检查更新' }).disabled).toBe(false);
});

it('读取失败可以手动重试，来源未知时显示官方指南而不提供更新', async () => {
  fetchMock.mockRejectedValueOnce(new Error('synthetic-network-detail'));
  mount();
  await screen.findByRole('alert');
  expect(screen.queryByText(/synthetic-network-detail/)).toBeNull();
  fetchMock.mockResolvedValue(
    json({ ...newer, source: 'unknown', canUpdate: false, message: '无法确认安装来源，请按官方说明更新。' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  await screen.findByText('无法确认安装来源，请按官方说明更新。');
  expect(screen.queryByRole('button', { name: '更新' })).toBeNull();
  expect(screen.getByRole('link', { name: '官方安装指南' }).getAttribute('href')).toBe(initial.guideUrl);
});

it('仅阻止同一CLI的前后台运行回合，无关CLI不影响更新', async () => {
  fetchMock.mockResolvedValue(json(newer));
  useChat.setState({ agent: 'codex', running: true });
  mount();
  const update = await screen.findByRole<HTMLButtonElement>('button', { name: '更新' });
  expect(update.disabled).toBe(false);
  act(() => useChat.setState({ background: { task: { ...useChat.getState(), agent: 'claude', running: true } } }));
  expect(update.disabled).toBe(true);
  expect(screen.getByText(/结束此 CLI 的运行会话后再安装或更新/)).toBeTruthy();
});

it.each([
  ['agent_busy', /结束该 CLI 会话后重试/],
  ['check_required', /先重新检查最新版本/],
  ['revision_conflict', /本机安装状态已变化/],
  ['installation_busy', /已有安装或更新任务/],
  ['unsupported', /当前安装来源不支持/],
])('更新被拒绝时区分%s原因，且不输出接口的原始详情', async (code, message) => {
  fetchMock
    .mockResolvedValueOnce(json(newer))
    .mockResolvedValueOnce(json({ code, message: 'synthetic-private-detail' }, 409));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '更新' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(message));
  expect(screen.queryByText(/synthetic-private-detail/)).toBeNull();
  expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ action: 'update', revision: initial.revision }));
});
