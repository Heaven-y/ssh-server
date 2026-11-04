// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentCapabilities, ClientMessage, ServerMessage, Workspace } from '@agentdeck/shared';
import { ChatView } from '../../../src/features/chat/ChatView';
import { Composer } from '../../../src/features/chat/Composer';
import { ManualModelDialog } from '../../../src/features/chat/ManualModelDialog';
import { startChatConnection, useChat } from '../../../src/features/chat/chat-store';
import { api, ApiError, queryKeys } from '../../../src/lib/api';

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
    client.setQueryData(queryKeys.sessions(workspace.id, agent), []);
    client.setQueryData(queryKeys.agentCapabilities(workspace.id, agent), { ...catalog, agent });
  }
  vi.spyOn(api, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
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

it('打开模型菜单、技能和斜杠只读缓存，点击刷新才发现能力', async () => {
  const refresh = vi.spyOn(api, 'refreshAgentCapabilities').mockResolvedValue({
    ...catalog,
    agent: 'claude',
    models: [{ id: 'fresh-model', label: '新报告的模型', reasoningEfforts: [] }],
  });
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByRole('menuitemradio', { name: /候选模型/ });
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '/' } });
  await screen.findByRole('listbox', { name: '原生命令补全' });
  fireEvent.keyDown(screen.getByLabelText('输入消息'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '技能与命令' }));
  const dialog = screen.getByRole('dialog', { name: '技能与命令' });
  expect(refresh).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/刷新能力会启动 CLI 检查账号/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '刷新能力' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith(workspace.id, 'claude'));
  await waitFor(() =>
    expect(
      client.getQueryData<AgentCapabilities>(queryKeys.agentCapabilities(workspace.id, 'claude'))?.models[0]?.id,
    ).toBe('fresh-model'),
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭技能与命令' }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect(await screen.findByRole('menuitemradio', { name: /新报告的模型/ })).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('Antigravity历史不可回放仍可续聊，保留权限说明且不伪造审批', async () => {
  vi.spyOn(api, 'sessionEvents').mockRejectedValue(new ApiError(501, '不能回放', { code: 'session_not_replayable' }));
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'agy-native' });
  showChat();
  expect(screen.getByText(/Antigravity 的原生历史暂不能回放/)).toBeTruthy();
  expect(screen.getByText(/权限由 Antigravity 原生配置决定/)).toBeTruthy();
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
  const read = vi.spyOn(api, 'sessionEvents').mockRejectedValueOnce(new Error('文件被占用'));
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
  await menuChoose('模型选项', /候选模型/);
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
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '旧草稿' } });
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
  expect(
    plus.compareDocumentPosition(within(controls).getByRole('button', { name: '模型选项' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await menuChoose('模型选项', /候选模型/);
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
  expect(screen.getByRole('button', { name: '模型选项' }).textContent).toContain('正在读取型号');
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
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('自动');
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  expect(await screen.findByRole('menuitemradio', { name: '自动' })).toBeTruthy();
  expect(screen.queryByRole('menuitemradio', { name: 'high' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '自动' }));
  await menuChoose('模型选项', /候选模型/);
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
  client.removeQueries({ queryKey: queryKeys.agentCapabilities(workspace.id, agent) });
  vi.spyOn(api, 'agentCapabilities').mockRejectedValue(new Error('模型列表暂不可用'));
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  await waitFor(() =>
    expect(client.getQueryState(queryKeys.agentCapabilities(workspace.id, agent))?.status).toBe('error'),
  );
  expect(screen.queryByRole('menuitemradio', { name: 'max' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '自动' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '保留我的模型' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent, model: 'manual-model', reasoningEffort: undefined });
});

it('Codex保留目录提供的扩展强度，不被常用档位覆盖', async () => {
  useChat.getState().setAgent('codex');
  useChat.getState().setModel('custom-model');
  client.setQueryData(queryKeys.agentCapabilities(workspace.id, 'codex'), {
    ...catalog,
    models: [{ id: 'custom-model', label: '扩展模型', reasoningEfforts: ['custom-effort'] }],
  });
  showChat();
  await menuChoose('推理强度', 'custom-effort');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '扩展强度' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent: 'codex', model: 'custom-model', reasoningEffort: 'custom-effort' });
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
  client.setQueryData(queryKeys.agentCapabilities(workspace.id, 'claude'), {
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

it('常规模型菜单只列真实候选，清除覆盖放次级操作且发送不带默认字样', async () => {
  showComposer();
  const trigger = screen.getByRole('button', { name: '模型选项' });
  expect(trigger.textContent).toContain('默认模型');
  fireEvent.click(trigger);
  const candidate = await screen.findByRole('menuitemradio', { name: /候选模型/ });
  expect(screen.queryByRole('menuitemradio', { name: /默认模型|沿用会话模型/ })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '手动填写模型' })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: '清除模型覆盖' })).toBeNull();
  expect(within(screen.getByRole('group', { name: '可选模型' })).getAllByRole('menuitemradio')).toEqual([candidate]);
  fireEvent.click(candidate);
  expect(useChat.getState().modelOverrides.claude).toBe('native-model');
  expect(trigger.textContent).toContain('native-model');
  await modelAction('清除模型覆盖');
  expect(useChat.getState().modelOverrides.claude).toBe('');
  expect(trigger.textContent).toContain('默认模型');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '沿用原生配置' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(JSON.parse(JSON.stringify(sent[0]))).not.toHaveProperty('model');
});

it.each([
  { actualModel: 'actual-history', nativeModel: 'configured-history', label: 'actual-history' },
  { actualModel: undefined, nativeModel: 'configured-history', label: 'configured-history' },
])('输入区区分历史证据与下一轮显式选择：$label', async ({ actualModel, nativeModel, label }) => {
  vi.spyOn(api, 'sessionEvents').mockResolvedValue({
    session: { agent: 'claude', sessionId: 'history', summary: '历史', lastModified: 1, nativeModel },
    actualModel,
    events: [],
  });
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'history' });
  showComposer();
  const trigger = screen.getByRole('button', { name: '模型选项' });
  expect(trigger.textContent).toContain(label);
  expect(useChat.getState().modelOverrides.claude).toBe('');
  await menuChoose('模型选项', /候选模型/);
  expect(trigger.textContent).toContain('native-model');
  expect(trigger.title).toContain('当前覆盖：native-model');
  await modelAction('清除模型覆盖');
  expect(trigger.textContent).toContain(label);
  if (actualModel) expect(trigger.title).toContain('最近实际运行：actual-history');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '继续历史' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ sessionId: 'history', model: undefined, reasoningEffort: undefined });
});

it('读取历史时明确显示读取状态，不将候选模型当作已取得的型号', () => {
  useChat.setState({ sessionId: 'history', loadingHistory: true });
  showComposer();
  const trigger = screen.getByRole<HTMLButtonElement>('button', { name: '模型选项' });
  expect(trigger.textContent).toContain('正在读取型号');
  expect(trigger.disabled).toBe(true);
  expect(trigger.textContent).not.toContain('native-model');
});

it('原生目录读取和空结果均有状态，不伪造默认模型候选', async () => {
  client.removeQueries({ queryKey: queryKeys.agentCapabilities(workspace.id, 'claude') });
  let resolve!: (value: AgentCapabilities) => void;
  vi.spyOn(api, 'agentCapabilities').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  await screen.findByText('正在加载模型…');
  await act(async () => resolve({ agent: 'claude', entries: [], models: [], warnings: [] }));
  expect(await screen.findByText('原生目录未报告可选模型。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '模型选项' }).textContent).toContain('默认模型');
  expect(screen.queryByRole('menuitemradio', { name: /默认模型/ })).toBeNull();
  expect(useChat.getState().modelOverrides.claude).toBe('');
});

it('手填模型不把空白或默认占位符发送为型号，恢复原生必须明确清除覆盖', () => {
  render(<ManualModelDialog model="" disabled={false} apply={useChat.getState().setModel} onClose={vi.fn()} />);
  const field = screen.getByLabelText('模型名称');
  const apply = screen.getByRole<HTMLButtonElement>('button', { name: '应用模型' });
  expect(apply.disabled).toBe(true);
  fireEvent.change(field, { target: { value: '默认' } });
  expect(apply.disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('模型 ID');
  fireEvent.click(apply);
  expect(useChat.getState().modelOverrides.claude).toBe('');
  expect(sent).toHaveLength(0);
});

it.each(['claude', 'codex'] as const)('输入区%s自动强度省略字段，并使用各自目录报告的档位', async (agent) => {
  useChat.getState().setAgent(agent);
  useChat.getState().setModel('native-model');
  client.setQueryData(queryKeys.agentCapabilities(workspace.id, agent), {
    ...catalog,
    agent,
    models: [{ id: 'native-model', label: '候选模型', reasoningEfforts: ['custom-effort'] }],
  });
  showComposer();
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  await screen.findByRole('menuitemradio', { name: '自动' });
  expect(screen.getByRole('menuitemradio', { name: 'custom-effort' })).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitemradio', { name: '自动' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '使用原生自动强度' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(JSON.parse(JSON.stringify(sent[0]))).not.toHaveProperty('reasoningEffort');
});

it('上下文用量和窗口与模型强度同区，来源及原生比例通过详情说明', async () => {
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
  const context = options.getByRole('button', { name: '上下文用量' });
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

it('无数据不渲染上下文按钮，Codex不按用量除窗口推算比例', async () => {
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
  expect(details.queryByText(/%/)).toBeNull();
  act(() => useChat.setState({ contextUsage: { source: 'codex_native', usedTokens: 0 } }));
  expect(context.textContent).toContain('上下文 0');
});

it('输入控制行保留压缩进度与未确认状态，展开可看原生说明', async () => {
  useChat.setState({
    running: true,
    compaction: { status: 'running', trigger: 'manual', beforeTokens: 500, message: '原生压缩说明' },
  });
  showComposer();
  const context = within(screen.getByRole('group', { name: '消息选项' })).getByRole('button', { name: '上下文用量' });
  expect(context.textContent).toContain('正在压缩');
  act(() => useChat.setState({ running: false }));
  expect(context.textContent).toContain('压缩结果未确认');
  fireEvent.click(context);
  const details = within(await screen.findByRole('dialog', { name: '上下文用量详情' }));
  expect(details.getByText('原生压缩说明')).toBeTruthy();
  expect(details.getByText(/压缩前 500 tokens/)).toBeTruthy();
});
