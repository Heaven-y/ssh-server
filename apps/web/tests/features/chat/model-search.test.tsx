// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentModel } from '@agentdeck/shared/conversation';
import { ModelOptionsMenu } from '../../../src/features/chat/ModelOptionsMenu';
import { useChat } from '../../../src/features/chat/chat-store';
import { chatApi, chatKeys } from '../../../src/features/chat/api';
import { settingsApi } from '../../../src/features/settings/api';
import { useAgentCapabilities } from '../../../src/features/chat/use-agent-capabilities';

let client: QueryClient;
const models: AgentModel[] = Array.from({ length: 65 }, (_, index) => ({
  id: `model-${index}`,
  label: `候选${index}`,
  modelId: index === 64 ? 'custom-native' : `native-${index}`,
}));
beforeEach(() => {
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace('project');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(chatKeys.agentCapabilities('project', 'claude'), {
    agent: 'claude',
    discovered: true,
    models,
    entries: [],
    warnings: [],
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(settingsApi, 'readEnvironment').mockResolvedValue({ checkedAt: 1, tools: [] });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

function mount() {
  render(
    <QueryClientProvider client={client}>
      <ModelOptionsMenu disabled={false} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '模型选项' }));
}

it('菜单只展示少量候选并优先保留当前选择，搜索能找到末尾真实型号且不重新发现', async () => {
  useChat.getState().setModel('model-64[1m]');
  const refresh = vi.spyOn(chatApi, 'refreshAgentCapabilities');
  mount();
  const group = await screen.findByRole('group', { name: '可选模型' });
  expect(within(group).getAllByRole('menuitemradio')).toHaveLength(20);
  expect(
    within(group)
      .getByRole('menuitemradio', { name: /custom-native/ })
      .getAttribute('aria-checked'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('menuitem', { name: '搜索全部模型' }));
  const dialog = screen.getByRole('dialog', { name: '选择模型' });
  const search = within(dialog).getByRole('combobox', { name: '搜索模型' });
  fireEvent.change(search, { target: { value: 'custom-native' } });
  const option = await within(dialog).findByRole('option', { name: /custom-native/ });
  expect(within(dialog).getAllByRole('option')).toHaveLength(1);
  await waitFor(() => expect(screen.queryByRole('menu', { name: '模型选项菜单' })).toBeNull());
  search.focus();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  await waitFor(() => expect(search.getAttribute('aria-activedescendant')).toBe(option.id));
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  await waitFor(() => expect(search.getAttribute('aria-activedescendant')).toBe(option.id));
  fireEvent.keyDown(search, { key: 'Enter' });
  fireEvent.keyUp(search, { key: 'Enter' });
  await waitFor(() => expect(useChat.getState().modelOverrides.claude).toBe('model-64'));
  expect(refresh).not.toHaveBeenCalled();
});

it('全部候选可继续展开，手填型号仍在菜单中保留，关闭搜索不改变选择', async () => {
  useChat.getState().setModel('manual-custom');
  mount();
  expect(await screen.findByRole('menuitemradio', { name: /manual-custom/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem', { name: '搜索全部模型' }));
  const dialog = screen.getByRole('dialog', { name: '选择模型' });
  expect(within(dialog).getAllByRole('option')).toHaveLength(50);
  fireEvent.click(within(dialog).getByRole('button', { name: '显示更多模型' }));
  expect(within(dialog).getAllByRole('option')).toHaveLength(66);
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭选择模型' }));
  expect(useChat.getState().modelOverrides.claude).toBe('manual-custom');
  await act(async () => undefined);
});

it('成功目录被回收后允许重新发现，读取与手动刷新仍由各自缓存状态触发', async () => {
  const key = chatKeys.agentCapabilities('project', 'claude');
  client.removeQueries({ queryKey: key });
  const empty = { agent: 'claude' as const, discovered: false, models: [], entries: [], warnings: [] };
  vi.spyOn(chatApi, 'agentCapabilities').mockResolvedValue(empty);
  const refresh = vi
    .spyOn(chatApi, 'refreshAgentCapabilities')
    .mockResolvedValue({ ...empty, discovered: true, models });
  const mountHook = () =>
    renderHook(() => useAgentCapabilities(true, true), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
  const first = mountHook();
  await waitFor(() => expect(first.result.current.data?.models).toHaveLength(65));
  first.unmount();
  client.removeQueries({ queryKey: key });
  const second = mountHook();
  await waitFor(() => expect(second.result.current.data?.models).toHaveLength(65));
  expect(refresh).toHaveBeenCalledTimes(2);
});
