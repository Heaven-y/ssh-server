// @vitest-environment jsdom
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Workspace } from '@agentdeck/shared';
import { ProjectManageDialog } from '../../src/app/ProjectManageDialog';
import { api, ApiError, queryKeys } from '../../src/lib/api';
import { sessionActionKey, useChat } from '../../src/features/chat/chat-store';

const project: Workspace = { id: 'demo', name: '原项目', dir: path.resolve('fixtures', 'demo') };
const other: Workspace = { id: 'other', name: '其他项目', dir: path.resolve('fixtures', 'other') };
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.workspaces, [project, other]);
  client.setQueryData(['sessions', 'unassigned', 'claude'], []);
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().selectWorkspace(project.id);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});
function mount(action: 'rename' | 'directory' | 'remove', target = project) {
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ProjectManageDialog project={target} action={action} onClose={close} />
    </QueryClientProvider>,
  );
  return close;
}

it('改名只提交名称，目录离线也不触碰目录或原生会话', async () => {
  const update = vi.spyOn(api, 'updateProject').mockResolvedValue({ ...project, name: '新的名称' });
  useChat.setState({ sessionId: 'native-session' });
  const close = mount('rename');
  fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新的名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存项目名称' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(update).toHaveBeenCalledWith(project.id, { name: '新的名称' });
  expect(useChat.getState().sessionId).toBe('native-session');
  expect(client.getQueryData<Workspace[]>(queryKeys.workspaces)?.[0]?.name).toBe('新的名称');
});

it('换目录清当前旧会话、模型和能力缓存，不删除其他项目缓存', async () => {
  const dir = path.resolve('fixtures', 'replacement');
  vi.spyOn(api, 'updateProject').mockResolvedValue({ ...project, dir });
  const historyKey = queryKeys.sessionHistory(project.id, 'codex', 'native-session');
  const capabilitiesKey = queryKeys.agentCapabilities(project.id, 'codex');
  client.setQueryData(historyKey, { private: 'old-history' });
  client.setQueryData(capabilitiesKey, { models: ['old-model'] });
  client.setQueryData(queryKeys.agentCapabilities(other.id, 'codex'), { models: ['other-model'] });
  const key = sessionActionKey(project.id, { agent: 'codex', sessionId: 'native-session' });
  useChat.setState({
    sessionId: 'native-session',
    agent: 'codex',
    modelOverrides: { claude: '', codex: 'old-model', antigravity: '' },
    reasoningEfforts: { claude: '', codex: 'high', antigravity: '' },
    sessionModels: { [key]: { actualModel: 'old-model' } },
  });
  const close = mount('directory');
  fireEvent.change(screen.getByLabelText('项目目录'), { target: { value: dir } });
  fireEvent.click(screen.getByRole('button', { name: '更换目录' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(useChat.getState()).toMatchObject({
    workspaceId: project.id,
    sessionId: undefined,
    agent: 'codex',
    modelOverrides: { codex: '' },
    reasoningEfforts: { codex: '' },
    sessionModels: {},
  });
  expect(client.getQueryData(historyKey)).toBeUndefined();
  expect(client.getQueryData(capabilitiesKey)).toBeUndefined();
  expect(client.getQueryData(queryKeys.agentCapabilities(other.id, 'codex'))).toEqual({ models: ['other-model'] });
  expect(client.getQueryState(['sessions', 'unassigned', 'claude'])?.isInvalidated).toBe(true);
});

it('运行或发送准备中禁用；迟到成功不切走后来选中的项目', async () => {
  let resolve!: (project: Workspace) => void;
  const update = vi.spyOn(api, 'updateProject').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount('directory');
  fireEvent.change(screen.getByLabelText('项目目录'), { target: { value: other.dir } });
  act(() => useChat.setState({ pendingClientTurnId: 'pending' }));
  const save = screen.getByRole<HTMLButtonElement>('button', { name: '更换目录' });
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(update).not.toHaveBeenCalled();
  act(() => useChat.setState({ pendingClientTurnId: undefined }));
  fireEvent.click(save);
  act(() => {
    useChat.getState().selectWorkspace(other.id);
    useChat.setState({ sessionId: 'other-session' });
  });
  await act(async () => resolve({ ...project, dir: other.dir }));
  expect(useChat.getState()).toMatchObject({ workspaceId: other.id, sessionId: 'other-session' });
});

it('后端拒绝换目录时保留草稿与旧会话，放弃修改仍需确认', async () => {
  vi.spyOn(api, 'updateProject').mockRejectedValue(new ApiError(409, '项目正在使用，请稍后重试。'));
  useChat.setState({ sessionId: 'native-session' });
  const close = mount('directory');
  fireEvent.change(screen.getByLabelText('项目目录'), { target: { value: other.dir } });
  fireEvent.click(screen.getByRole('button', { name: '更换目录' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText<HTMLInputElement>('项目目录').value).toBe(other.dir);
  expect(useChat.getState().sessionId).toBe('native-session');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(window.confirm).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('同项目已选择新会话时，迟到的换目录响应也不能清空新选择或参数', async () => {
  let resolve!: (value: Workspace) => void;
  vi.spyOn(api, 'updateProject').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount('directory');
  fireEvent.change(screen.getByLabelText('项目目录'), { target: { value: other.dir } });
  fireEvent.click(screen.getByRole('button', { name: '更换目录' }));
  act(() => {
    useChat.getState().newSession('codex');
    useChat.setState({ sessionId: 'new-selection' });
    useChat.getState().setModel('new-model');
    useChat.getState().setReasoningEffort('high');
  });
  await act(async () => resolve({ ...project, dir: other.dir }));
  expect(useChat.getState()).toMatchObject({
    workspaceId: project.id,
    sessionId: 'new-selection',
    agent: 'codex',
    modelOverrides: { codex: 'new-model' },
    reasoningEfforts: { codex: 'high' },
  });
});

it('移除只调用项目记录接口，确认前不删除，当前选择切到剩余项目', async () => {
  const remove = vi.spyOn(api, 'deleteProject').mockResolvedValue(undefined);
  const close = mount('remove');
  expect(screen.getByText(/不删除磁盘目录/)).toBeTruthy();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认移除项目' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(remove).toHaveBeenCalledWith(project.id);
  expect(useChat.getState().workspaceId).toBe(other.id);
  expect(client.getQueryData(queryKeys.workspaces)).toEqual([other]);
  expect(client.getQueryState(['sessions', 'unassigned', 'claude'])?.isInvalidated).toBe(true);
});
