// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SlurmSnapshot, Workspace } from '@ssh-server/shared';
import { ResourcesPanel } from '../../../src/features/resources/ResourcesPanel';
import { useChat } from '../../../src/features/chat/chat-store';
import { api, queryKeys } from '../../../src/lib/api';
import { credentials, server, settings, snapshot, workspace } from './fixtures';

let client: QueryClient;
const output =
  '             JOBID PARTITION                     NAME     USER ST       TIME  NODES NODELIST(REASON)\n' +
  '               123       gpu <img src=x onerror=alert(1)>     demo PD       0:00      1 (Resources) & "中文"';
let result: SlurmSnapshot;
let reads: { signal?: AbortSignal; resolve(value: Response): void }[];
let pending: boolean;
let visible: 'visible' | 'hidden';
beforeEach(() => {
  vi.useFakeTimers();
  visible = 'visible';
  useChat.setState({ connection: 'open' });
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  vi.spyOn(api, 'readProductSettings').mockResolvedValue(settings);
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([server]);
  vi.spyOn(api, 'readResources').mockImplementation(async () => snapshot());
  result = { sampledAt: Date.now() - 120_000, status: 'available', output, truncated: false };
  pending = false;
  reads = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          reads.push({ signal: init?.signal as AbortSignal | undefined, resolve });
          if (!pending) resolve(new Response(JSON.stringify(result)));
        }),
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.sshHosts, [server]);
  client.setQueryData(queryKeys.sshCredentials(server.alias), credentials);
});
afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function tick(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function panel(active = true, current: Workspace = workspace) {
  return (
    <QueryClientProvider client={client}>
      <ResourcesPanel workspace={current} active={active} />
    </QueryClientProvider>
  );
}
function jobs() {
  return within(screen.getByRole('region', { name: 'Slurm作业' }));
}
const outputBox = () => jobs().getByRole('region', { name: '当前账号作业输出' });
const queryOutputBox = () => jobs().queryByRole('region', { name: '当前账号作业输出' });

it('仅首次打开和手动刷新作业，不随资源采样、焦点或重新展开自动查询', async () => {
  const view = render(panel(false));
  await tick();
  expect(reads).toHaveLength(0);
  view.rerender(panel());
  await tick();
  expect(outputBox().textContent).toBe(output);
  expect(reads).toHaveLength(1);
  expect(jobs().getByText('当前账号')).toBeTruthy();
  expect(jobs().queryByText(/共享账号|节点指标|只读查询，首次打开/)).toBeNull();
  expect(jobs().getByText(`作业更新：${new Date(result.sampledAt).toLocaleTimeString('zh-CN')}`)).toBeTruthy();
  await tick(120_000);
  fireEvent.focus(window);
  view.rerender(panel(false));
  await tick();
  view.rerender(panel());
  await tick();
  expect(reads).toHaveLength(1);
  result = { ...result, sampledAt: Date.now(), output: '' };
  fireEvent.click(jobs().getByRole('button', { name: '刷新作业' }));
  await tick();
  expect(reads).toHaveLength(2);
  expect(jobs().getByText('暂无作业')).toBeTruthy();
  expect(queryOutputBox()).toBeNull();
});

it('表格前导空格、换行及 HTML 特殊字符以纯文本展示，内部双向滚动且可键盘聚焦', async () => {
  render(panel());
  await tick();
  const box = outputBox();
  expect(box.tagName).toBe('PRE');
  expect(box.textContent).toBe(output);
  expect(box.children).toHaveLength(0);
  expect(box.querySelector('img, script')).toBeNull();
  expect(box.tabIndex).toBe(0);
  for (const style of ['font-mono', 'whitespace-pre', 'overflow-auto', 'max-h-[480px]', 'max-w-full', 'min-w-0'])
    expect(box.classList.contains(style)).toBe(true);
});

it.each(['unavailable', 'error'] as const)('作业%s不是空队列，失败不受资源成功状态掩盖', async (status) => {
  result = {
    ...result,
    status,
    output: '',
    message: status === 'unavailable' ? '未找到 squeue，请确认已安装 Slurm' : 'Slurm查询失败，请检查连接后重试',
  };
  render(panel());
  await tick();
  expect(jobs().getByText(result.message!)).toBeTruthy();
  expect(jobs().queryByText('暂无作业')).toBeNull();
  expect(queryOutputBox()).toBeNull();
  await tick(60_000);
  expect(reads).toHaveLength(1);
});

it('长文本与截断原样显示，只提示前 200 行而不是精确作业数', async () => {
  result = { ...result, truncated: true, output: `${output}\n  ?? UNLIMITED compute-01 ${'长名称'.repeat(1000)}` };
  render(panel());
  await tick();
  expect(outputBox().textContent).toBe(result.output);
  expect(jobs().getByText('仅显示前200行')).toBeTruthy();
  expect(jobs().queryByText(/200条|200个|共有/)).toBeNull();
});

it('隐藏取消在途作业请求，迟到结果不显示；再次打开可补读未完成的首次请求', async () => {
  pending = true;
  const view = render(panel());
  await tick();
  expect(reads).toHaveLength(1);
  view.rerender(panel(false));
  await tick();
  expect(reads[0]!.signal!.aborted).toBe(true);
  await act(async () => reads[0]!.resolve(new Response(JSON.stringify(result))));
  view.rerender(panel());
  await tick();
  expect(queryOutputBox()).toBeNull();
  expect(reads).toHaveLength(2);
  await act(async () => reads[1]!.resolve(new Response(JSON.stringify({ ...result, output: '' }))));
  await tick();
  expect(jobs().getByText('暂无作业')).toBeTruthy();
});

it('浏览器隐藏也取消查询，迟到结果不回填，恢复后仅补读未完成请求', async () => {
  pending = true;
  render(panel());
  await tick();
  visible = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await tick();
  expect(reads[0]!.signal!.aborted).toBe(true);
  await act(async () => reads[0]!.resolve(new Response(JSON.stringify(result))));
  expect(queryOutputBox()).toBeNull();
  visible = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await tick();
  expect(reads).toHaveLength(2);
  await act(async () => reads[1]!.resolve(new Response(JSON.stringify({ ...result, output: '' }))));
  await tick();
  expect(jobs().getByText('暂无作业')).toBeTruthy();
});

it('固定目标变化隔离旧作业，旧请求不能在新目标完成后覆盖它', async () => {
  pending = true;
  const view = render(panel());
  await tick();
  view.rerender(panel(true, { ...workspace, remoteDir: '~/projects/other' }));
  await tick();
  expect(reads[0]!.signal!.aborted).toBe(true);
  expect(reads).toHaveLength(2);
  await act(async () => reads[1]!.resolve(new Response(JSON.stringify({ ...result, output: '' }))));
  await act(async () => reads[0]!.resolve(new Response(JSON.stringify(result))));
  await tick();
  expect(queryOutputBox()).toBeNull();
  expect(jobs().getByText('暂无作业')).toBeTruthy();
});

it.each(['credentials', 'profile'] as const)(
  '同别名%s变化立即清除旧作业，需要显式刷新且拒绝旧请求回填',
  async (kind) => {
    const view = render(panel());
    await tick();
    expect(outputBox().textContent).toBe(output);
    pending = true;
    fireEvent.click(jobs().getByRole('button', { name: '刷新作业' }));
    await tick();
    await act(async () => {
      if (kind === 'credentials')
        await client.invalidateQueries({ queryKey: queryKeys.sshCredentials(server.alias), refetchType: 'none' });
      else client.setQueryData(queryKeys.sshHosts, [{ ...server, hostname: 'changed.invalid' }]);
    });
    await tick();
    expect(reads[1]!.signal!.aborted).toBe(true);
    await act(async () => reads[1]!.resolve(new Response(JSON.stringify(result))));
    expect(queryOutputBox()).toBeNull();
    expect(jobs().getByText(/服务器配置或认证已变化，请手动刷新作业/)).toBeTruthy();
    view.rerender(panel(false));
    view.rerender(panel());
    await tick(60_000);
    expect(reads).toHaveLength(2);
    pending = false;
    result = { ...result, output: '' };
    fireEvent.click(jobs().getByRole('button', { name: '刷新作业' }));
    await tick();
    expect(jobs().getByText('暂无作业')).toBeTruthy();
  },
);

it('手动刷新中隐藏后保留旧快照，重新展开可再次刷新而不是永久加载', async () => {
  const view = render(panel());
  await tick();
  pending = true;
  fireEvent.click(jobs().getByRole('button', { name: '刷新作业' }));
  await tick();
  view.rerender(panel(false));
  await tick();
  expect(reads[1]!.signal!.aborted).toBe(true);
  view.rerender(panel());
  await tick();
  expect(reads).toHaveLength(2);
  expect(outputBox().textContent).toBe(output);
  expect(jobs().getByRole<HTMLButtonElement>('button', { name: '刷新作业' }).disabled).toBe(false);
  pending = false;
  result = { ...result, output: '' };
  fireEvent.click(jobs().getByRole('button', { name: '刷新作业' }));
  await tick();
  expect(reads).toHaveLength(3);
  expect(jobs().getByText('暂无作业')).toBeTruthy();
});

it.each([false, true])('成功结果保留不完整警告，不能把警告空结果说成确定空队列（空=%s）', async (empty) => {
  result = { ...result, output: empty ? '' : output, message: 'Slurm 返回警告，结果可能不完整' };
  render(panel());
  await tick();
  expect(jobs().getByRole('status').textContent).toBe(result.message);
  if (empty) {
    expect(jobs().queryByText('暂无作业')).toBeNull();
    expect(jobs().getByText('本次查询没有返回内容')).toBeTruthy();
    expect(queryOutputBox()).toBeNull();
  } else expect(outputBox().textContent).toBe(output);
  expect(reads).toHaveLength(1);
});
