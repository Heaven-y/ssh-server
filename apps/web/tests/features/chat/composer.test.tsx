// @vitest-environment jsdom
import { ApiError } from '../../../src/lib/http';
import { settingsApi } from '../../../src/features/settings/api';
import { chatApi, chatKeys } from '../../../src/features/chat/api';
import { projectsKeys } from '../../../src/features/projects/api';
import { sessionsApi, sessionsKeys } from '../../../src/features/sessions/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentCapabilities, ClientMessage, ServerMessage } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import { ChatView } from '../../../src/features/chat/ChatView';
import { Composer } from '../../../src/features/chat/Composer';
import { ManualModelDialog } from '../../../src/features/chat/ManualModelDialog';
import { startChatConnection, useChat } from '../../../src/features/chat/chat-store';

import { invalidateNativeCapabilities } from '../../../src/cli/shared/capability-cache';
import { useAgentCapabilities } from '../../../src/features/chat/use-agent-capabilities';

const workspace: Workspace = {
  id: 'workspace',
  name: '演示项目',
  server: 'my-server',
  dir: 'project',
  remoteDir: '~/projects/demo',
};
const skill = {
  id: 'demo',
  name: 'demo',
  kind: 'skill' as const,
  description: '演示技能',
  available: true,
  supportsArguments: true,
  requiresSession: false,
};
const unavailable = {
  ...skill,
  id: 'hidden',
  name: 'not-connected',
  available: false,
  unavailableReason: '尚未接入网页',
};
const catalog: AgentCapabilities = {
  agent: 'codex',
  entries: [skill, unavailable],
  models: [{ id: 'native-model', label: '候选模型', reasoningEfforts: ['low', 'high'] }],
  warnings: [],
};
const sent: ClientMessage[] = [];
let emit!: (message: ServerMessage) => void;
startChatConnection((handlers) => {
  emit = handlers.onMessage;
  return {
    send: (message) => {
      sent.push(message);
      return true;
    },
    reconnect() {},
    close() {},
  };
});
let client: QueryClient;
beforeEach(() => {
  sent.length = 0;
  // jsdom 缺少原生 dialog 方法；保留真实组件，只模拟开关属性。
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace(workspace.id);
  useChat.setState({ connection: 'open' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const agent of ['claude', 'codex', 'antigravity'] as const) {
    client.setQueryData(sessionsKeys.sessions(workspace.id, agent), []);
    client.setQueryData(chatKeys.agentCapabilities(workspace.id, agent), { ...catalog, agent });
  }
  vi.spyOn(settingsApi, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});
function showChat() {
  render(
    <QueryClientProvider client={client}>
      <ChatView workspace={workspace} />
    </QueryClientProvider>,
  );
}
function showComposer() {
  render(
    <QueryClientProvider client={client}>
      <Composer />
    </QueryClientProvider>,
  );
}
async function modelAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '更多模型操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}
async function menuChoose(menu: string, name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: menu }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name }));
}

it('模型已有缓存时直接显示；技能和斜杠只读缓存，点击刷新重新发现能力', async () => {
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities').mockResolvedValue({
    ...catalog,
    agent: 'claude',
    models: [{ id: 'fresh-model', label: '新报告的模型', reasoningEfforts: [] }],
  });
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menuitemradio', { name: /native-model/ });
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '/' } });
  await screen.findByRole('listbox', { name: '原生命令补全' });
  fireEvent.keyDown(screen.getByLabelText('输入消息'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '技能与命令' }));
  const dialog = screen.getByRole('dialog', { name: '技能与命令' });
  expect(refresh).not.toHaveBeenCalled();
  expect(within(dialog).queryByText(/刷新能力会启动 CLI 检查账号/)).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '刷新能力' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith(workspace.id, 'claude', undefined));
  await waitFor(() =>
    expect(
      client.getQueryData<AgentCapabilities>(chatKeys.agentCapabilities(workspace.id, 'claude'))?.models[0]?.id,
    ).toBe('fresh-model'),
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭技能与命令' }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect(await screen.findByRole('menuitemradio', { name: /fresh-model/ })).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('首次打开模型菜单自动发现一次，复用缓存且不会发送对话', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    agent: 'claude',
    discovered: false,
    entries: [],
    models: [],
    warnings: ['打开模型菜单或点击刷新即可读取 CLI 能力。'],
  });
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities').mockResolvedValue({
    ...catalog,
    agent: 'claude',
    discovered: true,
    models: [{ id: 'opus', label: '自定义模型', description: 'Custom Opus model' }],
  });
  showComposer();
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menuitemradio', { name: /opus/ });
  expect(refresh).toHaveBeenCalledExactlyOnceWith(workspace.id, 'claude', undefined);
  expect(screen.queryByText(/未报告可选模型/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menuitemradio', { name: /opus/ });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(sent).toHaveLength(0);
});

it('当前会话提前读取缓存，重建输入区及重开菜单不重新请求；手动刷新保留已有选项', async () => {
  client.removeQueries({ queryKey: chatKeys.agentCapabilities(workspace.id, 'claude') });
  const cached = { ...catalog, agent: 'claude' as const, discovered: true, defaultModel: 'native-model' };
  const read = vi.spyOn(chatApi, 'agentCapabilities').mockResolvedValue(cached);
  let resolve!: (value: AgentCapabilities) => void;
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  showComposer();
  await waitFor(() => expect(screen.getByRole('button', { name: '模型选项' }).textContent).toBe('native-model'));
  expect(read).toHaveBeenCalledTimes(1);
  cleanup();
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect((await screen.findByRole('menuitemradio', { name: /^native-model/ })).getAttribute('aria-checked')).toBe(
    'true',
  );
  expect(useChat.getState().modelOverrides.claude).toBe('');
  expect(read).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: '刷新模型列表' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('正在加载模型…')).toBeNull();
  expect(screen.getByRole('menuitemradio', { name: /^native-model/ })).toBeTruthy();
  await act(async () => resolve(cached));
});

it('首次打开强度也能发现默认型号，Claude [1m] 选择原样发送且采用型号档位', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    agent: 'claude',
    discovered: false,
    entries: [],
    models: [],
    warnings: [],
  });
  vi.spyOn(chatApi, 'refreshAgentCapabilities').mockResolvedValue({
    ...catalog,
    agent: 'claude',
    discovered: true,
    defaultModel: 'sonnet[1m]',
    models: [{ id: 'sonnet[1m]', label: '长上下文模型', modelId: 'claude-sonnet-4-6[1m]' }],
  });
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'high' }));
  expect(screen.getByRole('button', { name: '模型选项' }).textContent).toContain('claude-sonnet-4-6[1m]');
  expect(useChat.getState().modelOverrides.claude).toBe('');
  await menuChoose('模型选项', /^claude-sonnet-4-6/);
  expect(useChat.getState().reasoningEfforts.claude).toBe('');
  await menuChoose('推理强度', 'max');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '测试选择' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ model: 'sonnet[1m]', reasoningEffort: 'max' });
});

it('Claude 上下文由用户切换，打开菜单不启用 1M，切换保留强度且原样发送后缀', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    ...catalog,
    agent: 'claude',
    defaultModel: 'sonnet',
    models: [{ id: 'sonnet', label: 'Sonnet', modelId: 'claude-sonnet-4-6', reasoningEfforts: ['high'] }],
  });
  useChat.getState().setReasoningEffort('high');
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  const group = within(await screen.findByRole('group', { name: 'Claude 上下文窗口' }));
  expect(group.getByRole('menuitemradio', { name: '默认窗口' }).getAttribute('aria-checked')).toBe('true');
  expect(useChat.getState().modelOverrides.claude).toBe('');
  fireEvent.click(group.getByRole('menuitemradio', { name: '1M' }));
  expect(useChat.getState().modelOverrides.claude).toBe('sonnet[1m]');
  expect(useChat.getState().reasoningEfforts.claude).toBe('high');
  await menuChoose('模型选项', '默认窗口');
  expect(useChat.getState().modelOverrides.claude).toBe('sonnet');
  await menuChoose('模型选项', '1M');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '使用长上下文' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ model: 'sonnet[1m]', reasoningEffort: 'high' });
});

it('Claude 别名已绑定 1M 时可显式选择默认窗口，其他 CLI 不显示后缀开关', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    ...catalog,
    agent: 'claude',
    defaultModel: 'opus',
    models: [{ id: 'opus', label: 'Opus', modelId: 'custom-model[1M]' }],
  });
  showComposer();
  await menuChoose('模型选项', '默认窗口');
  expect(useChat.getState().modelOverrides.claude).toBe('custom-model');
  expect(screen.getByRole('button', { name: '模型选项' }).textContent).not.toContain('[1M]');
  act(() => useChat.getState().setAgent('codex'));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menu', { name: '模型选项菜单' });
  expect(screen.queryByRole('group', { name: 'Claude 上下文窗口' })).toBeNull();
});

it('重启恢复的模型缓存不重复获取，打开技能时补取命令目录', async () => {
  const persisted = { ...catalog, discovered: true, commandsDiscovered: false, entries: [] };
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), persisted);
  const refresh = vi
    .spyOn(chatApi, 'refreshAgentCapabilities')
    .mockResolvedValue({ ...catalog, discovered: true, commandsDiscovered: true });
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menuitemradio', { name: /native-model/ });
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.click(screen.getByRole('button', { name: '技能与命令' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      client.getQueryData<AgentCapabilities>(chatKeys.agentCapabilities(workspace.id, 'claude'))?.commandsDiscovered,
    ).toBe(true),
  );
  expect(sent).toHaveLength(0);
});

it('自动发现失败显示可重试状态，重开菜单不循环检查账号', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    agent: 'claude',
    discovered: false,
    entries: [],
    models: [],
    warnings: [],
  });
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities').mockRejectedValue(new Error('读取失败'));
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect(refresh).toHaveBeenCalledTimes(1);
  refresh.mockResolvedValue({ ...catalog, agent: 'claude', discovered: true });
  fireEvent.click(await screen.findByRole('menuitem', { name: '重试' }));
  await screen.findByRole('menuitemradio', { name: /native-model/ });
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('保存原生配置后重新发现模型，旧刷新响应不能回填旧目录', async () => {
  const empty = { agent: 'claude' as const, discovered: false, entries: [], models: [], warnings: [] };
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), empty);
  vi.spyOn(chatApi, 'agentCapabilities').mockResolvedValue(empty);
  let resolve!: (value: AgentCapabilities) => void;
  const pending = new Promise<AgentCapabilities>((done) => {
    resolve = done;
  });
  const fresh = {
    ...catalog,
    agent: 'claude' as const,
    discovered: true,
    models: [{ id: 'updated-model', label: '更新后的模型' }],
  };
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities').mockReturnValueOnce(pending).mockResolvedValue(fresh);
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await act(async () => {
    await invalidateNativeCapabilities('claude', client);
  });
  await screen.findByRole('menuitemradio', { name: /updated-model/ });
  await act(async () => {
    resolve({ ...catalog, agent: 'claude', discovered: true });
  });
  expect(client.getQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'))).toEqual(fresh);
});

it('配置保存前发起的刷新不会把忙碌或失败状态带入新配置', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<AgentCapabilities>((_resolve, fail) => {
    reject = fail;
  });
  const fresh = { ...catalog, agent: 'claude' as const, models: [{ id: 'new-generation', label: '新配置模型' }] };
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities').mockReturnValueOnce(pending).mockResolvedValue(fresh);
  vi.spyOn(chatApi, 'agentCapabilities').mockResolvedValue({ ...catalog, agent: 'claude' });
  const hook = renderHook(() => useAgentCapabilities(true), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await act(async () => {
    await invalidateNativeCapabilities('claude', client);
  });
  await waitFor(() => expect(hook.result.current.isFetching).toBe(false));
  act(() => hook.result.current.refresh());
  await waitFor(() => expect(hook.result.current.data).toEqual(fresh));
  await act(async () => {
    reject(new Error('旧配置刷新失败'));
  });
  await waitFor(() => expect(hook.result.current.isError).toBe(false));
  expect(hook.result.current.data).toEqual(fresh);
});

it('旧版 Antigravity 历史不可回放仍可续聊，不常驻防御性说明或伪造审批', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockRejectedValue(
    new ApiError(501, '不能回放', { code: 'session_not_replayable' }),
  );
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'agy-native' });
  showChat();
  expect(screen.getByText(/Antigravity 的原生历史暂不能回放/)).toBeTruthy();
  expect(screen.queryByText(/权限由 Antigravity 原生配置决定/)).toBeNull();
  expect(screen.queryByRole('button', { name: /允许|批准/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '继续处理' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({
    agent: 'antigravity',
    sessionId: 'agy-native',
    model: undefined,
    reasoningEffort: undefined,
  });
});

it('历史读取失败保留可编辑草稿，重读成功才恢复发送', async () => {
  const read = vi.spyOn(sessionsApi, 'sessionEvents').mockRejectedValueOnce(new Error('文件被占用'));
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'native' });
  showChat();
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '待发送' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送' }).disabled).toBe(true);
  read.mockResolvedValue({
    session: { agent: 'codex', sessionId: 'native', summary: '会话', lastModified: 1 },
    events: [],
  });
  fireEvent.click(screen.getByRole('button', { name: '重新读取历史' }));
  await waitFor(() => expect(useChat.getState().historyError).toBeUndefined());
  expect(screen.getByRole('heading', { name: '继续原生会话' })).toBeTruthy();
  expect(screen.getByLabelText<HTMLTextAreaElement>('输入消息').value).toBe('待发送');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送' }).disabled).toBe(false);
});

it('更换模型清除旧模型的强度覆盖，避免发送不支持的参数', async () => {
  showChat();
  await menuChoose('模型选项', /native-model/);
  await menuChoose('推理强度', 'high');
  await modelAction('手动填写模型');
  fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'another-model' } });
  fireEvent.click(screen.getByRole('button', { name: '应用模型' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '新模型的原生强度' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ model: 'another-model', reasoningEffort: undefined });
});

it('切换会话隔离草稿，首次原生身份回填保留当前输入框', async () => {
  showChat();
  const first = useChat.getState().conversationId;
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '旧草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '轨迹' }));
  act(() => useChat.getState().newSession('antigravity'));
  const input = screen.getByLabelText<HTMLTextAreaElement>('输入消息');
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: '首次发送' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  act(() => {
    emit({
      type: 'turn.started',
      turnId: 'agy-turn',
      clientTurnId: useChat.getState().pendingClientTurnId!,
      workspaceId: workspace.id,
      agent: 'antigravity',
    });
    emit({
      type: 'agent.event',
      turnId: 'agy-turn',
      event: { type: 'session', agent: 'antigravity', sessionId: 'agy-native', cwd: 'project', model: 'native' },
    });
  });
  expect(screen.getByLabelText('输入消息')).toBe(input);
  act(() => useChat.getState().openConversation(first));
  expect(screen.getByLabelText<HTMLTextAreaElement>('输入消息').value).toBe('旧草稿');
  expect(screen.getByRole('button', { name: '轨迹' }).getAttribute('aria-pressed')).toBe('true');
});

it.each(['claude', 'codex'] as const)('一体输入底栏用菜单设置%s模型与强度，发送带参数且停止有效', async (agent) => {
  useChat.getState().setAgent(agent);
  showChat();
  const input = screen.getByLabelText('输入消息');
  const controls = screen.getByRole('group', { name: '消息选项' });
  expect(input.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByLabelText('模型名称')).toBeNull();
  expect(screen.queryByText(/Enter 发送/)).toBeNull();
  const plus = within(controls).getByRole('button', { name: '技能与命令' });
  const permission = within(controls).getByRole('button', { name: '权限模式' });
  expect(
    permission.compareDocumentPosition(within(controls).getByRole('button', { name: '模型选项' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await menuChoose('模型选项', /native-model/);
  await menuChoose('推理强度', 'high');
  fireEvent.click(plus);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /demo/ }));
  fireEvent.change(input, { target: { value: '执行任务' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent[0]).toMatchObject({
    type: 'chat.send',
    agent,
    model: 'native-model',
    reasoningEffort: 'high',
    selection: { id: 'demo' },
    text: '执行任务',
  });
  expect(screen.getByRole('button', { name: '模型选项' }).getAttribute('disabled')).not.toBeNull();
  expect(plus.getAttribute('disabled')).not.toBeNull();
  act(() => {
    emit({
      type: 'turn.started',
      workspaceId: workspace.id,
      agent,
      clientTurnId: useChat.getState().pendingClientTurnId!,
      turnId: 'turn',
    });
    emit({
      type: 'agent.event',
      turnId: 'turn',
      event: { type: 'session', sessionId: 'native', agent, cwd: '.', model: 'reported-model' },
    });
  });
  expect(within(controls).getByRole('button', { name: '模型选项' }).title).toContain('当前覆盖：native-model');
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  expect(sent.at(-1)).toEqual({ type: 'chat.interrupt', turnId: 'turn' });
  act(() => emit({ type: 'turn.finished', turnId: 'turn', workspaceId: workspace.id, agent }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect(await screen.findByText('最近实际运行：reported-model')).toBeTruthy();
});

it('历史固定Agent，载入期间禁用选项；ShiftEnter与IME不发送且正文草稿保留', async () => {
  useChat.setState({ sessionId: 'history', loadingHistory: true });
  showChat();
  expect(screen.getByRole('button', { name: '模型选项' }).getAttribute('disabled')).not.toBeNull();
  expect(screen.getByRole('button', { name: '模型选项' }).getAttribute('aria-busy')).toBe('true');
  const input = screen.getByLabelText('输入消息');
  fireEvent.change(input, { target: { value: '保留草稿' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent).toHaveLength(0);
  act(() => useChat.setState({ loadingHistory: false }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect((await screen.findByRole('menuitemradio', { name: 'Codex' })).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(sent).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent[0]).toMatchObject({
    text: '保留草稿',
    sessionId: 'history',
    model: undefined,
    reasoningEffort: undefined,
  });
});

it('强度菜单只列当前模型实际报告的档位，默认不覆盖', async () => {
  showChat();
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('跟随配置');
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  expect(await screen.findByRole('menuitemradio', { name: '跟随配置' })).toBeTruthy();
  expect(screen.queryByRole('menuitemradio', { name: 'high' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '跟随配置' }));
  await menuChoose('模型选项', /native-model/);
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  expect(await screen.findByRole('menuitemradio', { name: 'low' })).toBeTruthy();
  expect(screen.getByRole('menuitemradio', { name: 'high' })).toBeTruthy();
  expect(screen.queryByRole('menuitemradio', { name: 'max' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'low' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '使用已报告的参数' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent: 'claude', model: 'native-model', reasoningEffort: 'low' });
});

it.each(['claude', 'codex', 'antigravity'] as const)('%s手填模型且目录失败时仍能沿用原生强度发送', async (agent) => {
  useChat.getState().setAgent(agent);
  useChat.getState().setModel('manual-model');
  client.removeQueries({ queryKey: chatKeys.agentCapabilities(workspace.id, agent) });
  vi.spyOn(chatApi, 'agentCapabilities').mockRejectedValue(new Error('模型列表暂不可用'));
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  await waitFor(() =>
    expect(client.getQueryState(chatKeys.agentCapabilities(workspace.id, agent))?.status).toBe('error'),
  );
  expect(screen.queryByRole('menuitemradio', { name: 'max' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '跟随配置' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '保留我的模型' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent, model: 'manual-model', reasoningEffort: undefined });
});

it('Codex保留目录提供的扩展强度，不被常用档位覆盖', async () => {
  useChat.getState().setAgent('codex');
  useChat.getState().setModel('custom-model');
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'codex'), {
    ...catalog,
    models: [{ id: 'custom-model', label: '扩展模型', reasoningEfforts: ['custom-effort'] }],
  });
  showChat();
  await menuChoose('推理强度', 'custom-effort');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '扩展强度' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent: 'codex', model: 'custom-model', reasoningEffort: 'custom-effort' });
});

it('显示原生配置的具体强度，清除显式选择后恢复显示但不发送覆盖参数', async () => {
  useChat.getState().setAgent('codex');
  useChat.getState().setModel('native-model');
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'codex'), {
    ...catalog,
    defaultModel: 'native-model',
    defaultReasoningEffort: 'high',
    models: [{ ...catalog.models[0], defaultReasoningEffort: 'low' }],
  });
  showComposer();
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('high');
  expect(useChat.getState().reasoningEfforts.codex).toBe('');
  await menuChoose('推理强度', 'low');
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('low');
  await menuChoose('推理强度', '跟随配置 · high');
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('high');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '继续处理' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(JSON.parse(JSON.stringify(sent[0]))).not.toHaveProperty('reasoningEffort');
});

it('未知能力仍可跟随配置，原生明确不支持后隐藏入口并清除旧强度选择', async () => {
  useChat.getState().setModel('custom-model');
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    ...catalog,
    agent: 'claude',
    models: [{ id: 'custom-model', label: '自定义模型' }],
  });
  showComposer();
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('跟随配置');
  act(() => {
    useChat.getState().setReasoningEffort('high');
    client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
      ...catalog,
      agent: 'claude',
      models: [{ id: 'custom-model', label: '自定义模型', reasoningEfforts: [] }],
    });
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: '推理强度' })).toBeNull());
  expect(useChat.getState().reasoningEfforts.claude).toBe('');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '继续处理' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(JSON.parse(JSON.stringify(sent[0]))).not.toHaveProperty('reasoningEffort');
});

it('只有原生报告的 auto 才显示自动，并按真实档位发送', async () => {
  useChat.getState().setAgent('codex');
  useChat.getState().setModel('custom-model');
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'codex'), {
    ...catalog,
    models: [{ id: 'custom-model', label: '自定义模型', reasoningEfforts: ['auto', 'high'] }],
  });
  showComposer();
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('跟随配置');
  await menuChoose('推理强度', '自动');
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('自动');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '使用原生档位' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent: 'codex', reasoningEffort: 'auto' });
});

it('手填模型只在次级对话框，Enter不隐式发送，确认后仍能由正文发送', async () => {
  showChat();
  const input = screen.getByLabelText('输入消息');
  fireEvent.change(input, { target: { value: '非空消息正文' } });
  await modelAction('手动填写模型');
  const option = screen.getByLabelText('模型名称');
  fireEvent.change(option, { target: { value: 'manual-model' } });
  expect(fireEvent.keyDown(option, { key: 'ArrowDown' })).toBe(true);
  expect(fireEvent.keyDown(option, { key: 'Enter' })).toBe(false);
  expect(sent).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '应用模型' }));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent[0]).toMatchObject({ type: 'chat.send', text: '非空消息正文', model: 'manual-model' });
});

it('能力选择器默认只列网页可执行项，限制说明按需展开且不影响正文', async () => {
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '技能与命令' }));
  const dialog = screen.getByRole('dialog', { name: '技能与命令' });
  expect(within(dialog).getByRole('button', { name: /demo/ })).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: /not-connected/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: /查看不可用能力/ }));
  expect(
    within(dialog)
      .getByRole('button', { name: /not-connected/ })
      .getAttribute('disabled'),
  ).not.toBeNull();
  expect(within(dialog).getByText('尚未接入网页')).toBeTruthy();
  expect(sent).toHaveLength(0);
});

it('斜杠补全与选择器共用可执行筛选，不默认铺开不可执行命令', async () => {
  showChat();
  const input = screen.getByLabelText('输入消息');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '/' } });
  const completion = await screen.findByRole('listbox', { name: '原生命令补全' });
  expect(within(completion).getByRole('option', { name: /demo/ })).toBeTruthy();
  expect(within(completion).queryByRole('option', { name: /not-connected/ })).toBeNull();
  fireEvent.click(within(completion).getByRole('option', { name: /demo/ }));
  expect(sent).toHaveLength(0);
  expect(useChat.getState().selectedCapability?.id).toBe('demo');
});

it('原生目录部分读取失败显示警告，不把失败呈现为无技能', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    ...catalog,
    agent: 'claude',
    entries: [],
    warnings: ['Claude 技能与命令读取失败，请刷新重试'],
  });
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '技能与命令' }));
  await within(screen.getByRole('dialog', { name: '技能与命令' })).findByText('Claude 技能与命令读取失败，请刷新重试');
  expect(screen.queryByText('暂无技能或命令。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '关闭技能与命令' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '/' } });
  const completion = await screen.findByRole('listbox', { name: '原生命令补全' });
  expect(within(completion).getByText('Claude 技能与命令读取失败，请刷新重试')).toBeTruthy();
  expect(within(completion).queryByText('没有匹配的技能或命令。')).toBeNull();
});

it('模型按钮与列表只显示真实型号，清除覆盖放次级操作且发送不带默认字样', async () => {
  showComposer();
  const trigger = screen.getByRole('button', { name: '模型选项' });
  expect(trigger.textContent).toBe('');
  fireEvent.click(trigger);
  const candidate = await screen.findByRole('menuitemradio', { name: /native-model/ });
  expect(screen.queryByRole('menuitemradio', { name: '沿用原生配置' })).toBeNull();
  expect(screen.queryByText('候选模型')).toBeNull();
  expect(screen.queryByText('默认模型')).toBeNull();
  expect(screen.getByRole('menuitemradio', { name: 'Codex' }).textContent).toBe('');
  expect(screen.queryByRole('menuitem', { name: '手动填写模型' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '清除模型覆盖' })).toBeNull();
  expect(within(screen.getByRole('group', { name: '可选模型' })).getAllByRole('menuitemradio')).toEqual([candidate]);
  fireEvent.click(candidate);
  expect(useChat.getState().modelOverrides.claude).toBe('native-model');
  expect(trigger.textContent).toBe('native-model');
  await modelAction('清除模型覆盖');
  expect(useChat.getState().modelOverrides.claude).toBe('');
  expect(trigger.textContent).toBe('');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '沿用原生配置' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(JSON.parse(JSON.stringify(sent[0]))).not.toHaveProperty('model');
});

it.each([
  { actualModel: 'actual-history', nativeModel: 'configured-history', label: 'configured-history' },
  { actualModel: undefined, nativeModel: 'configured-history', label: 'configured-history' },
])('输入区区分历史证据与下一轮显式选择：$label', async ({ actualModel, nativeModel, label }) => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue({
    session: { agent: 'claude', sessionId: 'history', summary: '历史', lastModified: 1, nativeModel },
    actualModel,
    events: [],
  });
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'history' });
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude', 'history'), {
    ...catalog,
    agent: 'claude',
    defaultModel: 'configured-history',
    defaultReasoningEffort: 'high',
  });
  showComposer();
  const trigger = screen.getByRole('button', { name: '模型选项' });
  expect(trigger.textContent).toContain(label);
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('跟随配置');
  expect(useChat.getState().modelOverrides.claude).toBe('');
  await menuChoose('模型选项', /native-model/);
  expect(trigger.textContent).toContain('native-model');
  expect(trigger.title).toContain('当前覆盖：native-model');
  await modelAction('清除模型覆盖');
  expect(trigger.textContent).toContain(label);
  expect(trigger.title).toContain('原生会话配置：configured-history');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '继续历史' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ sessionId: 'history', model: undefined, reasoningEffort: undefined });
});

it('读取历史时明确显示读取状态，不将候选模型当作已取得的型号', () => {
  useChat.setState({ sessionId: 'history', loadingHistory: true });
  showComposer();
  const trigger = screen.getByRole<HTMLButtonElement>('button', { name: '模型选项' });
  expect(trigger.getAttribute('aria-busy')).toBe('true');
  expect(trigger.disabled).toBe(true);
  expect(trigger.textContent).not.toContain('native-model');
});

it('原生目录读取显示进度，空结果只保留图标而不生成占位型号', async () => {
  client.removeQueries({ queryKey: chatKeys.agentCapabilities(workspace.id, 'claude') });
  let resolve!: (value: AgentCapabilities) => void;
  vi.spyOn(chatApi, 'agentCapabilities').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByText('正在加载模型…');
  await act(async () => resolve({ agent: 'claude', entries: [], models: [], warnings: [] }));
  expect(screen.queryByText('CLI 未提供可选模型，可沿用原生配置或手动填写。')).toBeNull();
  expect(screen.getByRole('button', { name: '模型选项' }).textContent).toBe('');
  expect(within(screen.getByRole('group', { name: '可选模型' })).queryAllByRole('menuitemradio')).toHaveLength(0);
  expect(useChat.getState().modelOverrides.claude).toBe('');
});

it('手填模型不把空白或默认占位符发送为型号，恢复原生必须明确清除覆盖', () => {
  render(<ManualModelDialog model="" disabled={false} apply={useChat.getState().setModel} onClose={vi.fn()} />);
  const field = screen.getByLabelText('模型名称');
  const apply = screen.getByRole<HTMLButtonElement>('button', { name: '应用模型' });
  expect(apply.disabled).toBe(true);
  fireEvent.change(field, { target: { value: '默认' } });
  expect(apply.disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('模型名称或标识');
  fireEvent.click(apply);
  expect(useChat.getState().modelOverrides.claude).toBe('');
  expect(sent).toHaveLength(0);
});

it('模型菜单不显示技能错误；失效目录保留真实原因并能打开目录选择', async () => {
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, 'claude'), {
    ...catalog,
    agent: 'claude',
    modelWarning: '',
    commandWarnings: ['技能读取失败'],
    warnings: ['技能读取失败'],
  });
  client.setQueryData(projectsKeys.workspaces, [workspace]);
  vi.spyOn(chatApi, 'refreshAgentCapabilities').mockRejectedValue(
    new ApiError(409, '工作区目录不可用，请重新选择文件夹。', { code: 'workspace_directory_unavailable' }),
  );
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menuitemradio', { name: /native-model/ });
  expect(within(screen.getByRole('menu', { name: '模型选项菜单' })).queryByText('技能读取失败')).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '刷新模型列表' }));
  await screen.findByText('工作区目录不可用，请重新选择文件夹。');
  expect(screen.queryByText('模型列表加载失败，请刷新重试。')).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: '更换工作区目录' }));
  expect(await screen.findByRole('dialog', { name: '更换项目目录' })).toBeTruthy();
});

it.each(['claude', 'codex'] as const)('输入区%s跟随配置时省略强度字段，并使用各自目录报告的档位', async (agent) => {
  useChat.getState().setAgent(agent);
  useChat.getState().setModel('native-model');
  client.setQueryData(chatKeys.agentCapabilities(workspace.id, agent), {
    ...catalog,
    agent,
    models: [{ id: 'native-model', label: '候选模型', reasoningEfforts: ['custom-effort'] }],
  });
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  await screen.findByRole('menuitemradio', { name: '跟随配置' });
  expect(!!screen.queryByRole('menuitemradio', { name: 'custom-effort' })).toBe(agent === 'codex');
  fireEvent.click(screen.getByRole('menuitemradio', { name: '跟随配置' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '使用原生配置强度' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(JSON.parse(JSON.stringify(sent[0]))).not.toHaveProperty('reasoningEffort');
});

it('上下文用量位于输入框下方，来源及原生比例通过详情说明', async () => {
  useChat.setState({
    contextUsage: {
      source: 'claude_estimate',
      usedTokens: 12800,
      windowTokens: 200000,
      percentage: 6.4,
      model: 'reported-context-model',
    },
  });
  showComposer();
  const options = within(screen.getByRole('group', { name: '消息选项' }));
  const context = within(screen.getByRole('group', { name: '会话统计' })).getByRole('button', { name: '上下文用量' });
  expect(options.queryByRole('button', { name: '上下文用量' })).toBeNull();
  expect(context.closest('.composer-card')).toBeNull();
  expect(options.getByRole('button', { name: '模型选项' })).toBeTruthy();
  expect(options.getByRole('button', { name: '推理强度' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '上下文用量' })).toEqual([context]);
  expect(context.textContent).toContain('12,800 / 200,000');
  expect(context.title).toContain('Claude 原生估计');
  fireEvent.click(context);
  const details = within(await screen.findByRole('dialog', { name: '上下文用量详情' }));
  expect(details.getByText(/用量 12,800 tokens \/ 窗口 200,000 tokens · 6\.4%/)).toBeTruthy();
  expect(details.getByText('模型：reported-context-model')).toBeTruthy();
  expect(sent).toHaveLength(0);
});

it('无数据不渲染上下文按钮，有有效窗口时显示最近报告的占比', async () => {
  showComposer();
  // 无原生报告且无压缩事件时，上下文按钮整体隐藏，不再猜测窗口或比例
  expect(screen.queryByRole('button', { name: '上下文用量' })).toBeNull();
  act(() => useChat.setState({ contextUsage: { source: 'codex_native', usedTokens: 200, windowTokens: 1000 } }));
  const context = screen.getByRole('button', { name: '上下文用量' });
  expect(context.textContent).toContain('200 / 1,000');
  expect(context.title).toContain('Codex 原生统计/估算');
  fireEvent.click(context);
  const details = within(await screen.findByRole('dialog', { name: '上下文用量详情' }));
  expect(details.getByText(/用量 200 tokens \/ 窗口 1,000 tokens/)).toBeTruthy();
  expect(details.getByText(/用量 200 tokens \/ 窗口 1,000 tokens · 20%/)).toBeTruthy();
  expect(screen.getByLabelText('上下文占用 20%')).toBeTruthy();
  act(() => useChat.setState({ contextUsage: { source: 'codex_native', usedTokens: 0 } }));
  expect(context.textContent).toContain('上下文 0');
  expect(screen.queryByLabelText('上下文占用 20%')).toBeNull();
});

it('输入框下方保留压缩进度与未确认状态，展开可看原生说明', async () => {
  useChat.setState({
    running: true,
    compaction: { status: 'running', trigger: 'manual', beforeTokens: 500, message: '原生压缩说明' },
  });
  showComposer();
  const context = within(screen.getByRole('group', { name: '会话统计' })).getByRole('button', { name: '上下文用量' });
  expect(context.textContent).toContain('正在压缩');
  act(() => useChat.setState({ running: false }));
  expect(context.textContent).toContain('压缩结果未确认');
  fireEvent.click(context);
  const details = within(await screen.findByRole('dialog', { name: '上下文用量详情' }));
  expect(details.getByText('原生压缩说明')).toBeTruthy();
  expect(details.getByText(/压缩前 500 tokens/)).toBeTruthy();
});
