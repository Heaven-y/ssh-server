// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentCapabilities, ClientMessage, ServerMessage, Workspace } from '@ssh-server/shared';
import { ChatView } from '../../../src/features/chat/ChatView';
import { startChatConnection, useChat } from '../../../src/features/chat/chat-store';
import { api, queryKeys } from '../../../src/lib/api';

const workspace = { id: 'workspace', name: '演示项目' } as Workspace;
const skill = {
  id: 'demo',
  name: 'demo',
  kind: 'skill' as const,
  description: '演示技能',
  available: true,
  supportsArguments: true,
  requiresSession: false,
};
const catalog: AgentCapabilities = {
  agent: 'codex',
  entries: [skill],
  models: [{ id: 'native-model', label: '候选模型', reasoningEfforts: ['high'] }],
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
it('Agent、模型、推理和能力都在输入下方；更改后发送仍携带原生参数，停止有效', async () => {
  showChat();
  const input = screen.getByLabelText('输入消息');
  const controls = screen.getByRole('group', { name: '消息选项' });
  expect(input.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText(/Enter 发送/)).toBeNull();
  fireEvent.change(within(controls).getByLabelText('Agent'), { target: { value: 'codex' } });
  fireEvent.change(within(controls).getByLabelText('模型'), { target: { value: 'native-model' } });
  fireEvent.change(within(controls).getByLabelText('推理强度'), { target: { value: 'high' } });
  fireEvent.click(within(controls).getByRole('button', { name: '技能与命令' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /demo/ }));
  fireEvent.change(screen.getByLabelText('输入消息'), { target: { value: '执行任务' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(sent[0]).toMatchObject({
    type: 'chat.send',
    agent: 'codex',
    model: 'native-model',
    reasoningEffort: 'high',
    selection: { id: 'demo' },
    text: '执行任务',
  });
  expect(screen.getByLabelText('模型').getAttribute('disabled')).not.toBeNull();
  expect(screen.getByRole('button', { name: '技能与命令' }).getAttribute('disabled')).not.toBeNull();
  act(() => {
    emit({
      type: 'turn.started',
      workspaceId: workspace.id,
      agent: 'codex',
      clientTurnId: useChat.getState().pendingClientTurnId!,
      turnId: 'turn',
    });
    emit({
      type: 'agent.event',
      turnId: 'turn',
      event: { type: 'session', sessionId: 'native', agent: 'codex', cwd: '.', model: 'reported-model' },
    });
  });
  expect(screen.getByText('实际模型：reported-model')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '停止' }));
  expect(sent.at(-1)).toEqual({ type: 'chat.interrupt', turnId: 'turn' });
});
it('历史固定来源，模型空白不虚报；载入期间选项禁用，输入草稿不丢失', () => {
  useChat.setState({ sessionId: 'history', loadingHistory: true });
  showChat();
  expect(screen.getByLabelText('Agent').getAttribute('disabled')).not.toBeNull();
  expect(screen.getByLabelText('模型').getAttribute('disabled')).not.toBeNull();
  expect(screen.getByText('实际模型：未报告')).toBeTruthy();
  const input = screen.getByLabelText('输入消息');
  fireEvent.change(input, { target: { value: '保留草稿' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent).toHaveLength(0);
  act(() => useChat.setState({ loadingHistory: false }));
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(sent).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent[0]).toMatchObject({ text: '保留草稿', sessionId: 'history', model: undefined });
});
it.each(['模型', '推理强度'])('%s 的 Enter 阻止隐式提交但不吞普通按键，消息仍可由 textarea 发送', (label) => {
  useChat.getState().newSession('codex');
  showChat();
  const message = screen.getByLabelText('输入消息');
  const option = screen.getByLabelText(label);
  fireEvent.change(message, { target: { value: '非空消息正文' } });
  fireEvent.change(option, { target: { value: '手动选项' } });
  expect(fireEvent.keyDown(option, { key: 'ArrowDown' })).toBe(true);
  // jsdom 不执行隐式提交，直接断言防止该浏览器默认动作；真实键盘另由 Edge 回归覆盖。
  expect(fireEvent.keyDown(option, { key: 'Enter' })).toBe(false);
  expect(sent).toHaveLength(0);
  fireEvent.keyDown(message, { key: 'Enter' });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: 'chat.send', text: '非空消息正文' });
});
