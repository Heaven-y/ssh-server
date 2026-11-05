// @vitest-environment jsdom
import path from 'node:path';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSummary, Workspace } from '@agentdeck/shared';
import { Sidebar } from '../../src/app/Sidebar';
import { useProjectSessions } from '../../src/app/use-project-sessions';
import { useChat } from '../../src/features/chat/chat-store';
import { api, ApiError, queryKeys } from '../../src/lib/api';
import { queryClient } from '../../src/lib/query-client';
import { useUiPreferences } from '../../src/ui/ui-preferences';

const project: Workspace = { id: 'p1', name: '示例项目', dir: path.resolve('fixtures', 'demo') };
const otherProject: Workspace = { id: 'p2', name: '另一个项目', dir: path.resolve('fixtures', 'other') };
const base = {
  projectId: 'p1',
  running: false,
  updatedAt: new Date(1).toISOString(),
};
const claudeSession: SessionSummary = {
  ...base,
  agent: 'claude',
  sessionId: 'claude-1',
  title: '检查这个脚本',
};
const codexSession: SessionSummary = {
  ...base,
  agent: 'codex',
  sessionId: 'codex-1',
  title: '解释构建失败',
};
const orphan: SessionSummary = {
  ...base,
  agent: 'claude',
  sessionId: 'orphan-1',
  projectId: null,
  title: '孤儿会话',
};
const render = (element: ReactElement) =>
  renderView(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);

beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  useUiPreferences.setState({ sidebarCollapsed: false, sidebarAutoCollapsed: false, theme: 'light' });
  vi.spyOn(api, 'sessionChanges').mockResolvedValue({ revision: 1, watching: true });
  // jsdom 不实现 showModal；动作对话框用它，这里按项目既有做法打桩。
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('没有项目时显示引导添加项目', () => {
  render(<Sidebar projects={[]} sessionsByProject={{}} onAddProject={vi.fn()} />);
  expect(screen.getByText('添加项目目录')).toBeTruthy();
  expect(screen.getByText('还没有项目')).toBeTruthy();
});

it('新建会话包含Antigravity，明确把所选来源交给主界面', async () => {
  const start = vi.fn();
  render(<Sidebar projects={[project]} sessionsByProject={{}} onAddProject={vi.fn()} onNewSession={start} />);
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Antigravity' }));
  expect(start).toHaveBeenCalledExactlyOnceWith(project.id, 'antigravity');
});

it('按更新时间混排会话，同行显示来源并保留跨CLI同名身份', () => {
  const select = vi.fn();
  const claude = { ...claudeSession, sessionId: 'same-id' };
  const codex = { ...codexSession, sessionId: 'same-id', updatedAt: new Date(2).toISOString() };
  render(
    <Sidebar
      projects={[project]}
      sessionsByProject={{ p1: [claude, codex] }}
      onAddProject={vi.fn()}
      onSelectSession={select}
    />,
  );
  const rows = within(screen.getByRole('region', { name: '示例项目会话' })).getAllByRole('button', {
    name: / · (Claude|Codex)/,
  });
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining(codex.title),
    expect.stringContaining(claude.title),
  ]);
  expect(within(rows[0]!).getByTitle('Codex')).toBeTruthy();
  expect(within(rows[1]!).getByTitle('Claude')).toBeTruthy();
  fireEvent.click(rows[0]!);
  fireEvent.click(rows[1]!);
  expect(select.mock.calls).toEqual([
    [project.id, codex],
    [project.id, claude],
  ]);
});

it('无项目的新会话进入添加流程，折叠后仍能展开与打开设置', async () => {
  const add = vi.fn();
  const settings = vi.fn();
  render(<Sidebar projects={[]} sessionsByProject={{}} onAddProject={add} onOpenSettings={settings} />);
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  expect(add).toHaveBeenCalledExactlyOnceWith();
  fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
  expect(screen.queryByText('还没有项目')).toBeNull();
  expect(screen.getByRole('button', { name: '新建会话' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '设置与外观' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '设置' }));
  expect(settings).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
  expect(screen.getByText('还没有项目')).toBeTruthy();
});

it('工作区搜索同时匹配项目与会话，并能清空恢复列表', () => {
  render(
    <Sidebar
      projects={[project, otherProject]}
      sessionsByProject={{ p1: [claudeSession], p2: [{ ...codexSession, projectId: 'p2' }] }}
      onAddProject={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '搜索工作区与会话' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索工作区与会话' }), { target: { value: '构建失败' } });
  expect(screen.queryByRole('button', { name: /^示例项目/ })).toBeNull();
  expect(screen.getByText(codexSession.title)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }));
  expect(screen.getByRole('button', { name: /^示例项目/ })).toBeTruthy();
});

it('未归属会话默认不显示', () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [orphan] }} onAddProject={vi.fn()} />);
  expect(screen.queryByText('孤儿会话')).not.toBeTruthy();
  expect(screen.queryByText('其他目录')).not.toBeTruthy();
});

it('打开“显示其他目录的会话”后才列出未归属会话', async () => {
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [orphan] }} onAddProject={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '显示其他目录的会话' }));
  expect(screen.getByText('其他目录')).toBeTruthy();
  expect(screen.getByText('孤儿会话')).toBeTruthy();
});

it('其他目录只对有可信directory的会话提供预填项目入口', async () => {
  const add = vi.fn();
  const directory = path.resolve('fixtures', 'native-folder');
  render(
    <Sidebar
      projects={[project]}
      sessionsByProject={{ p1: [orphan, { ...orphan, sessionId: 'known-directory', title: '有目录', directory }] }}
      onAddProject={add}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '显示其他目录的会话' }));
  const region = within(screen.getByRole('region', { name: '其他目录的会话' }));
  expect(region.getAllByRole('button', { name: /加为项目/ })).toHaveLength(1);
  fireEvent.click(region.getByRole('button', { name: /加为项目/ }));
  expect(add).toHaveBeenCalledWith({ dir: directory, name: 'native-folder' });
});

it('没有项目时仍可查看独立传入的其他目录摘要，并通知按需读取', async () => {
  const show = vi.fn();
  render(
    <Sidebar
      projects={[]}
      sessionsByProject={{}}
      otherSessions={[orphan, orphan]}
      onShowOtherSessions={show}
      onAddProject={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '更多' }));
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '显示其他目录的会话' }));
  expect(show).toHaveBeenCalledExactlyOnceWith(true);
  expect(screen.getAllByText('孤儿会话')).toHaveLength(1);
});

it('项目菜单独立于服务器绑定，运行准备中连已打开的菜单也禁用', async () => {
  const manage = vi.fn();
  render(
    <Sidebar projects={[project]} sessionsByProject={{ p1: [] }} onAddProject={vi.fn()} onManageProject={manage} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '管理项目“示例项目”' }));
  const rename = await screen.findByRole('menuitem', { name: '重命名项目' });
  act(() => useChat.setState({ pendingClientTurnId: 'pending' }));
  expect(rename.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(rename);
  expect(manage).not.toHaveBeenCalled();
  act(() => useChat.setState({ pendingClientTurnId: undefined }));
  fireEvent.click(rename);
  expect(manage).toHaveBeenCalledWith(project, 'rename');
});

it('点项目行切换项目，点会话行把它交给调用方', () => {
  const selectProject = vi.fn();
  const selectSession = vi.fn();
  render(
    <Sidebar
      projects={[project, otherProject]}
      sessionsByProject={{ p1: [claudeSession], p2: [] }}
      onAddProject={vi.fn()}
      onSelectProject={selectProject}
      onSelectSession={selectSession}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /^另一个项目/ }));
  expect(selectProject).toHaveBeenCalledWith('p2');
  const group = screen.getByRole('region', { name: '示例项目会话' });
  // 会话行同时有「选中」按钮与悬停出现的「管理」按钮，两个都含标题文字，
  // 所以这里按 aria-label 的完整形态取选中按钮，避免歧义。
  fireEvent.click(within(group).getByRole('button', { name: /^检查这个脚本 · Claude/ }));
  expect(selectSession).toHaveBeenCalledWith('p1', claudeSession);
});

it('项目目录与服务器绑定收入项目菜单，保留原绑定回调', async () => {
  const bind = vi.fn();
  render(<Sidebar projects={[project]} sessionsByProject={{ p1: [] }} onAddProject={vi.fn()} onBindServer={bind} />);
  expect(screen.queryByText(project.dir)).toBeNull();
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBeTruthy();
  expect(screen.getByText('暂无会话')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '管理项目“示例项目”' }));
  expect(await screen.findByText(project.dir)).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: '绑定服务器' }));
  expect(bind).toHaveBeenCalledExactlyOnceWith(project);
});

it('受支持会话的管理入口先打开原生菜单，再选择重命名', async () => {
  // 动作对话框内部用到 useQueryClient，渲染它需要 provider。
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Sidebar projects={[project]} sessionsByProject={{ p1: [claudeSession] }} onAddProject={vi.fn()} />
    </QueryClientProvider>,
  );
  const group = screen.getByRole('region', { name: '示例项目会话' });
  fireEvent.click(within(group).getByRole('button', { name: /更多操作/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '重命名' }));
  // 复用既有的动作对话框：出现重命名输入框即说明入口真的接上了，而不只是画了个按钮。
  expect(screen.getByDisplayValue('检查这个脚本')).toBeTruthy();
});

function managedSidebar(sessions = [claudeSession, codexSession]) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar
        projects={[project]}
        sessionsByProject={{ p1: sessions }}
        onAddProject={vi.fn()}
        onSelectSession={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
function QueriedSidebar() {
  const sessions = useQuery({
    queryKey: queryKeys.sessions(project.id, 'codex'),
    queryFn: ({ signal }) => api.listSessions(project.id, 'codex', false, signal),
    retry: false,
  });
  return (
    <Sidebar
      projects={[project]}
      sessionsByProject={{ p1: [claudeSession, ...(sessions.data ?? [])] }}
      onAddProject={vi.fn()}
      onSelectSession={vi.fn()}
    />
  );
}
function ProjectSessionsSidebar() {
  const sessions = useProjectSessions([project, otherProject]);
  return (
    <Sidebar
      projects={[project, otherProject]}
      sessionsByProject={sessions.sessionsByProject}
      sessionErrorsByProject={sessions.errorsByProject}
      loadingSessions={sessions.loading}
      onRetrySessions={sessions.retryProject}
      onAddProject={vi.fn()}
    />
  );
}

it('项目会话单个CLI读取失败时保留其他来源，错误按项目展示且只重试失败来源', async () => {
  let failed = true;
  const list = vi.spyOn(api, 'listSessions').mockImplementation(async (id, agent) => {
    if (id === project.id && agent === 'codex') {
      if (failed) throw new ApiError(503, '原生目录暂不可用');
      return [codexSession];
    }
    return id === project.id && agent === 'claude' ? [claudeSession] : [];
  });
  render(<ProjectSessionsSidebar />);
  const group = within(screen.getByRole('region', { name: '示例项目会话' }));
  expect((await group.findByRole('alert')).textContent).toBe('Codex：原生目录暂不可用');
  expect(group.getByText(claudeSession.title)).toBeTruthy();
  expect(group.queryByText('暂无会话')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^另一个项目/ }));
  const otherGroup = within(screen.getByRole('region', { name: '另一个项目会话' }));
  expect(otherGroup.queryByRole('alert')).toBeNull();
  expect(otherGroup.getByText('暂无会话')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(6);
  failed = false;
  fireEvent.click(group.getByRole('button', { name: '重新读取会话' }));
  expect(await group.findByText(codexSession.title)).toBeTruthy();
  expect(group.queryByRole('alert')).toBeNull();
  expect(list).toHaveBeenCalledTimes(7);
  expect(list).toHaveBeenLastCalledWith(project.id, 'codex', false, expect.any(AbortSignal));
});

it('所有会话来源读取失败时不能显示暂无会话', async () => {
  vi.spyOn(api, 'listSessions').mockRejectedValue(new ApiError(503, '原生目录暂不可用'));
  render(<ProjectSessionsSidebar />);
  const group = within(screen.getByRole('region', { name: '示例项目会话' }));
  expect(await group.findAllByRole('alert')).toHaveLength(3);
  expect(group.queryByText('暂无会话')).toBeNull();
});
async function actionFor(title: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`会话“${title}”的更多操作`) }));
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

it('侧栏只展示CLI原生管理动作，Antigravity没有无效管理入口', async () => {
  managedSidebar([
    claudeSession,
    codexSession,
    { ...claudeSession, agent: 'antigravity', sessionId: 'agy', title: '引力会话' },
  ]);
  expect(screen.queryByRole('button', { name: /Antigravity.*更多操作/ })).toBeNull();
  const menuButton = screen.getByRole('button', { name: /Claude.*更多操作/ });
  menuButton.focus();
  expect(document.activeElement).toBe(menuButton);
  fireEvent.click(menuButton);
  expect(await screen.findByRole('menuitem', { name: '分叉会话' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: '归档' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: /置顶|复制/ })).toBeNull();
});

it('非当前项目删除只发送源行身份，必须确认且失败留在原处', async () => {
  useChat.getState().selectWorkspace('different-project');
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ message: '原生写入未确认' }), { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  managedSidebar();
  fireEvent.click(screen.getByRole('button', { name: /^示例项目/ }));
  await actionFor(claudeSession.title, '删除');
  const dialog = screen.getByRole('dialog', { name: '删除会话' });
  const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: '确认删除会话' });
  expect(confirm.disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(confirm);
  await within(dialog).findByText('原生写入未确认');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    '/api/projects/p1/sessions/claude/claude-1/actions',
    expect.objectContaining({ method: 'POST', body: '{"action":"delete","confirmed":true}' }),
  );
  expect(useChat.getState().workspaceId).toBe('different-project');
});

it('Codex归档按需读取，归档行只能恢复或删除，恢复刷新两种列表', async () => {
  const archived = { ...codexSession, sessionId: 'archived', title: '归档记录' };
  let restored = false;
  const list = vi
    .spyOn(api, 'listSessions')
    .mockImplementation(async (_project, _agent, isArchived) =>
      isArchived
        ? restored
          ? []
          : [
              archived,
              { ...archived, sessionId: 'foreign', title: '其他项目归档', projectId: 'p2' },
              { ...archived, sessionId: 'orphan', title: '无归属归档', projectId: null },
            ]
        : restored
          ? [codexSession, archived]
          : [codexSession],
    );
  const mutate = vi.spyOn(api, 'sessionAction').mockImplementation(async () => {
    restored = true;
  });
  render(
    <QueryClientProvider client={queryClient}>
      <QueriedSidebar />
    </QueryClientProvider>,
  );
  await screen.findByText(codexSession.title);
  expect(list.mock.calls.some((call) => call[2] === true)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /显示.*Codex 已归档会话/ }));
  expect(await screen.findByText('归档记录')).toBeTruthy();
  expect(screen.queryByText('其他项目归档')).toBeNull();
  expect(screen.queryByText('无归属归档')).toBeNull();
  expect(list).toHaveBeenCalledWith(project.id, 'codex', true, expect.any(AbortSignal));
  expect(screen.queryByRole('button', { name: /^归档记录 ·/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /会话“归档记录”的更多操作/ }));
  expect(await screen.findByRole('menuitem', { name: '恢复' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '分叉会话' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '恢复' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复到会话列表' }));
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledExactlyOnceWith(project.id, archived.sessionId, 'codex', { action: 'unarchive' }),
  );
  await screen.findByText('暂无 Codex 已归档会话');
  expect(await screen.findByRole('button', { name: /^归档记录 ·/ })).toBeTruthy();
  expect(
    queryClient
      .getQueryData<SessionSummary[]>(queryKeys.sessions(project.id, 'codex'))
      ?.map((entry) => entry.sessionId),
  ).toEqual([codexSession.sessionId, 'archived']);
});

it('已打开菜单在会话变忙后禁用，409失败后可重新操作', async () => {
  useChat.getState().selectWorkspace(project.id);
  const mutate = vi
    .spyOn(api, 'sessionAction')
    .mockRejectedValueOnce(new ApiError(409, '会话正在运行', { code: 'session_busy' }))
    .mockResolvedValue(undefined);
  managedSidebar();
  fireEvent.click(screen.getByRole('button', { name: /Claude.*更多操作/ }));
  await screen.findByRole('menuitem', { name: '删除' });
  act(() =>
    useChat.setState({ agent: 'claude', sessionId: claudeSession.sessionId, pendingClientTurnId: 'preparing' }),
  );
  expect(screen.getByRole('menuitem', { name: '删除' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => useChat.setState({ pendingClientTurnId: undefined }));
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
  fireEvent.change(screen.getByLabelText('会话名称'), { target: { value: '新标题' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await screen.findByText('会话正在运行');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存名称' }).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mutate).toHaveBeenCalledTimes(2);
});

it('归档确认框订阅原生摘要变化，变忙时停止恢复且不额外请求列表', async () => {
  const archived = { ...codexSession, sessionId: 'archived', title: '归档记录' };
  const list = vi.spyOn(api, 'listSessions').mockResolvedValue([archived]);
  const action = vi.spyOn(api, 'sessionAction');
  managedSidebar();
  fireEvent.click(screen.getByRole('button', { name: /显示.*Codex 已归档会话/ }));
  await screen.findByText(archived.title);
  await actionFor(archived.title, '恢复');
  act(() => {
    queryClient.setQueryData(queryKeys.sessions(project.id, 'codex', true), [{ ...archived, running: true }]);
  });
  expect(await screen.findByText('当前会话正在运行，结束后才能管理。')).toBeTruthy();
  const button = screen.getByRole('button', { name: '恢复到会话列表' });
  expect(button.closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(button);
  expect(action).not.toHaveBeenCalled();
  expect(list).toHaveBeenCalledTimes(1);
});

it('当前项目分叉经确认后读取并选中新原生身份', async () => {
  useChat.getState().selectWorkspace(project.id);
  const forked = { agent: 'claude' as const, sessionId: 'forked', summary: '新分叉', lastModified: 2 };
  const fork = vi.spyOn(api, 'sessionFork').mockResolvedValue({ session: forked });
  const read = vi.spyOn(api, 'sessionEvents').mockResolvedValue({ session: forked, events: [] });
  managedSidebar();
  await actionFor(claudeSession.title, '分叉会话');
  expect(fork).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认分叉' }));
  await waitFor(() => expect(useChat.getState().sessionId).toBe('forked'));
  expect(fork).toHaveBeenCalledExactlyOnceWith(project.id, claudeSession.sessionId, 'claude', {});
  expect(read).toHaveBeenCalledWith(project.id, 'forked', 'claude', expect.any(AbortSignal));
});

it('Codex归档读取失败只显示本分组错误，重试后恢复', async () => {
  const list = vi.spyOn(api, 'listSessions').mockRejectedValueOnce(new Error('原生目录暂不可用')).mockResolvedValue([]);
  managedSidebar();
  fireEvent.click(screen.getByRole('button', { name: /显示.*Codex 已归档会话/ }));
  expect(await screen.findByText('归档会话读取失败：原生目录暂不可用')).toBeTruthy();
  expect(screen.getByText(claudeSession.title)).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重新读取归档会话' }));
  expect(await screen.findByText('暂无 Codex 已归档会话')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(2);
});

it('原生摘要或当前回合运行时禁用菜单，操作处理中不重复发送', async () => {
  const mutate = vi.spyOn(api, 'sessionAction').mockImplementation(() => new Promise(() => undefined));
  managedSidebar([{ ...claudeSession, running: true }, codexSession]);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /Claude.*更多操作/ }).disabled).toBe(true);
  await actionFor(codexSession.title, '归档');
  const confirm = screen.getByRole('button', { name: '归档会话' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /Codex.*更多操作/ }).disabled).toBe(true);
  act(() =>
    useChat.setState({ workspaceId: project.id, agent: 'codex', sessionId: codexSession.sessionId, running: true }),
  );
  expect(screen.getByText('当前会话正在运行，结束后才能管理。')).toBeTruthy();
});
