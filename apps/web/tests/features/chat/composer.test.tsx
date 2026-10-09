// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentCapabilities, ClientMessage, ServerMessage, Workspace } from '@ssh-server/shared';
import { ChatView } from '../../../src/features/chat/ChatView';
import { startChatConnection, useChat } from '../../../src/features/chat/chat-store';
import { api, queryKeys } from '../../../src/lib/api';

const workspace: Workspace = {
  id: 'workspace',
  name: '演示项目',
  sshHost: 'my-server',
  localDir: 'project',
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
  for (const agent of ['claude', 'codex'] as const) {
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
async function menuChoose(menu: string, name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: menu }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name }));
}

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
  expect(screen.getByText('实际模型：reported-model')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  expect(sent.at(-1)).toEqual({ type: 'chat.interrupt', turnId: 'turn' });
});

it('历史固定Agent，载入期间禁用选项；ShiftEnter与IME不发送且正文草稿保留', async () => {
  useChat.setState({ sessionId: 'history', loadingHistory: true });
  showChat();
  expect(screen.getByRole('button', { name: '模型选项' }).getAttribute('disabled')).not.toBeNull();
  expect(screen.queryByText('实际模型：未报告')).toBeNull();
  const input = screen.getByLabelText('输入消息');
  fireEvent.change(input, { target: { value: '保留草稿' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent).toHaveLength(0);
  act(() => useChat.setState({ loadingHistory: false }));
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  expect((await screen.findByRole('menuitemradio', { name: 'Codex' })).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: '沿用会话模型' }));
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(sent).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent[0]).toMatchObject({
    text: '保留草稿',
    sessionId: 'history',
    model: undefined,
    reasoningEffort: 'high',
  });
});

it('默认模型也直接提供强度档位，切换Agent保留各自选择且不猜模型', async () => {
  showChat();
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('high');
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    expect(await screen.findByRole('menuitemradio', { name: effort })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'xhigh' }));
  expect(useChat.getState().modelOverrides.claude).toBe('');
  await menuChoose('模型选项', 'Codex');
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('high');
  await menuChoose('推理强度', 'low');
  await menuChoose('模型选项', 'Claude');
  expect(screen.getByRole('button', { name: '推理强度' }).textContent).toBe('xhigh');
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '默认模型也可调强度' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent: 'claude', model: undefined, reasoningEffort: 'xhigh' });
});

it.each(['claude', 'codex'] as const)('%s手填模型且目录失败时仍可选择max并原样发送', async (agent) => {
  useChat.getState().setAgent(agent);
  useChat.getState().setModel('manual-model');
  client.removeQueries({ queryKey: queryKeys.agentCapabilities(workspace.id, agent) });
  vi.spyOn(api, 'agentCapabilities').mockRejectedValue(new Error('模型列表暂不可用'));
  showChat();
  fireEvent.click(screen.getByRole('button', { name: '推理强度' }));
  await waitFor(() =>
    expect(client.getQueryState(queryKeys.agentCapabilities(workspace.id, agent))?.status).toBe('error'),
  );
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'max' }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '保留我的参数' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.at(-1)).toMatchObject({ agent, model: 'manual-model', reasoningEffort: 'max' });
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
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '手动填写模型' }));
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
