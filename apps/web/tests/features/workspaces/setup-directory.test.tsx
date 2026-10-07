// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductSettingsSchema, type WorkspaceInput } from '@ssh-server/shared';
import { api } from '../../../src/lib/api';
import { LocalStep } from '../../../src/features/workspaces/setup/LocalStep';
import { RemoteStep } from '../../../src/features/workspaces/setup/RemoteStep';
import { ConfirmStep } from '../../../src/features/workspaces/setup/ConfirmStep';
import { WorkspaceForm } from '../../../src/features/workspaces/WorkspaceForm';
import { DirectoryPicker } from '../../../src/features/workspaces/setup/DirectoryPicker';

const draft: WorkspaceInput = { name: '草稿', localDir: '', sshHost: 'my-server', remoteDir: '' };
const clients: QueryClient[] = [];
function mount(kind: 'local' | 'remote', initial = draft) {
  function Harness() {
    const [input, setInput] = useState(initial);
    const Step = kind === 'local' ? LocalStep : RemoteStep;
    return <Step input={input} change={(patch) => setInput((value) => ({ ...value, ...patch }))} />;
  }
  return render(<Harness />);
}
beforeEach(() => {
  vi.spyOn(api, 'closeSetupLocal').mockResolvedValue({ closed: true });
  vi.spyOn(api, 'closeSetupRemote').mockResolvedValue({ closed: true });
  vi.spyOn(api, 'openSetupRemote').mockResolvedValue({
    id: 'session',
    workspaceId: 'setup',
    sshHost: 'my-server',
    root: '/',
    home: '/home/user',
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});
it('本地从home打开后直接作为待使用目录，进入文件夹即更新草稿，无重复确认', async () => {
  vi.spyOn(api, 'setupLocalDirectory')
    .mockResolvedValueOnce({
      path: 'C:/home',
      parent: 'C:/',
      roots: ['C:/'],
      entries: [{ name: 'project2', path: 'C:/home/project2', type: 'directory' }],
    })
    .mockResolvedValueOnce({ path: 'C:/home/project2', parent: 'C:/home', roots: ['C:/'], entries: [] });
  mount('local');
  fireEvent.click(screen.getByRole('button', { name: '浏览本地文件夹' }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('本地文件夹').value).toBe('C:/home'));
  expect(api.setupLocalDirectory).toHaveBeenCalledWith({ path: undefined, cursor: undefined }, expect.any(AbortSignal));
  expect(screen.queryByRole('button', { name: '使用此目录' })).toBeNull();
  expect(screen.getByText(/待使用目录/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /进入.*project2/ }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('本地文件夹').value).toBe('C:/home/project2'));
  expect(document.activeElement).toBe(screen.getByRole('status'));
});
it.each(['', '~/projects/demo'])('远端从草稿路径%s打开，采用实际进入路径但不自动统计', async (path) => {
  vi.spyOn(api, 'readSetupRemote').mockResolvedValue({
    path: '/home/user/projects/demo',
    root: '/',
    outsideWorkspace: false,
    entries: [],
  });
  vi.spyOn(api, 'setupRemoteSize');
  mount('remote', { ...draft, remoteDir: path });
  fireEvent.click(screen.getByRole('button', { name: '浏览服务器目录' }));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>('服务器目录').value).toBe('/home/user/projects/demo'),
  );
  expect(api.readSetupRemote).toHaveBeenCalledWith(
    'session',
    { path: path || '~', cursor: undefined },
    expect.any(AbortSignal),
  );
  expect(api.setupRemoteSize).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '使用此目录' })).toBeNull();
});
it.each(['local', 'remote'] as const)('%s浏览迟到响应不能覆盖用户手动修改的新路径', async (kind) => {
  let resolve!: (value: { path: string; parent: string; roots: string[]; entries: [] }) => void;
  const late = new Promise<{ path: string; parent: string; roots: string[]; entries: [] }>((done) => {
    resolve = done;
  });
  vi.spyOn(api, 'setupLocalDirectory').mockReturnValue(late);
  vi.spyOn(api, 'readSetupRemote').mockImplementation(async () => ({
    ...(await late),
    root: '/',
    outsideWorkspace: false,
  }));
  mount(kind);
  fireEvent.click(screen.getByRole('button', { name: kind === 'local' ? '浏览本地文件夹' : '浏览服务器目录' }));
  if (kind === 'remote') await waitFor(() => expect(api.readSetupRemote).toHaveBeenCalled());
  const field = screen.getByLabelText<HTMLInputElement>(kind === 'local' ? '本地文件夹' : '服务器目录');
  fireEvent.change(field, { target: { value: '/manual' } });
  await act(async () => resolve({ path: '/late', parent: '/', roots: [], entries: [] }));
  expect(field.value).toBe('/manual');
  expect(screen.queryByLabelText('目录内容')).toBeNull();
});
it('确认页显示验证通过与实际目录，不暴露票据截止时间', () => {
  render(
    <ConfirmStep
      input={draft}
      ticket={{
        verification: 'ticket',
        binding: 'a'.repeat(64),
        expiresAt: Date.now() + 300000,
        local: { path: 'C:/actual', empty: true, git: false },
        remote: { path: '/actual', empty: true, git: false },
        target: { sshHost: draft.sshHost, authMode: 'key' },
      }}
      busy={false}
      creating={false}
      confirmed={false}
      setConfirmed={vi.fn()}
      verify={vi.fn()}
    />,
  );
  expect(screen.getByText(/验证通过/)).toBeTruthy();
  expect(screen.getByText('C:/actual')).toBeTruthy();
  expect(screen.getByText('/actual')).toBeTruthy();
  expect(screen.queryByText(/有效期至/)).toBeNull();
});
it('浏览中与进入失败不能沿用旧目录继续，成功后下一步直接采用当前目录，返回仍保留草稿', async () => {
  vi.spyOn(api, 'readProductSettings').mockResolvedValue({
    settings: ProductSettingsSchema.parse({}),
    revision: 'missing',
  });
  vi.spyOn(api, 'listSshHosts').mockResolvedValue([]);
  let resolve!: (value: Awaited<ReturnType<typeof api.setupLocalDirectory>>) => void;
  vi.spyOn(api, 'setupLocalDirectory')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValueOnce(new Error('无权限'))
    .mockResolvedValueOnce({ path: 'C:/new', parent: 'C:/', roots: [], entries: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <WorkspaceForm onCancel={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('工作区名称'), { target: { value: '草稿' } });
  fireEvent.change(screen.getByLabelText('本地文件夹'), { target: { value: 'C:/old' } });
  fireEvent.click(screen.getByRole('button', { name: '浏览本地文件夹' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一步' }).disabled).toBe(true);
  await act(async () =>
    resolve({
      path: 'C:/old',
      parent: 'C:/',
      roots: [],
      entries: [{ name: 'new', path: 'C:/new', type: 'directory' }],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '进入 new' }));
  await screen.findByText(/无权限/);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一步' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '进入 new' }));
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一步' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByLabelText('服务器');
  fireEvent.click(screen.getByRole('button', { name: '上一步' }));
  expect(screen.getByLabelText<HTMLInputElement>('本地文件夹').value).toBe('C:/new');
  expect(screen.getByLabelText<HTMLInputElement>('工作区名称').value).toBe('草稿');
});
it('目录分页保持服务端顺序，不对当前页重排；分页只发一次读取', () => {
  const browse = vi.fn();
  render(
    <DirectoryPicker
      path="/"
      parent="/"
      busy={false}
      nextCursor="page2"
      browse={browse}
      entries={[
        { name: '项目2', path: '/项目2', type: 'directory' },
        { name: '项目10', path: '/项目10', type: 'directory' },
        { name: 'a.txt', path: '/a.txt', type: 'file' },
      ]}
    />,
  );
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    '项目2进入',
    '项目10进入',
    'a.txt文件',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '加载下一页' }));
  expect(browse).toHaveBeenCalledExactlyOnceWith('/', 'page2');
});
