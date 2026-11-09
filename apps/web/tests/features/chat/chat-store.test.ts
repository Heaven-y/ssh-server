import { ApiError } from '../../../src/lib/http';
import { chatKeys } from '../../../src/features/chat/api';
import { sessionsApi, sessionsKeys } from '../../../src/features/sessions/api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { ProductSettingsSchema } from '@agentdeck/shared/settings';
import type {
  AgentCapability,
  AgentKind,
  ClientMessage,
  ServerMessage,
  SessionActionInput,
  SessionHistory,
} from '@agentdeck/shared/conversation';
import type { ConnectionStatus } from '../../../src/lib/ws';

// node 环境没有 localStorage，用内存实现
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
});

const { useChat, startChatConnection, lastWorkspaceId, sessionActionKey } =
  await import('../../../src/features/chat/chat-store');

const { queryClient } = await import('../../../src/lib/query-client');
afterEach(() => {
  vi.restoreAllMocks();
});

it('浏览器存储不可用时仍能恢复缺省、切换和移除内存工作区', () => {
  const failed = () => {
    throw new Error('存储不可用');
  };
  vi.stubGlobal('localStorage', { getItem: failed, setItem: failed, removeItem: failed });
  try {
    expect(lastWorkspaceId()).toBeUndefined();
    useChat.getState().selectWorkspace('first');
    expect(useChat.getState().workspaceId).toBe('first');
    useChat.getState().removeWorkspace('first', 'second');
    expect(useChat.getState().workspaceId).toBe('second');
    useChat.getState().selectWorkspace(undefined);
    expect(useChat.getState().workspaceId).toBeUndefined();
  } finally {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    });
  }
});

/** 假连接：记录发出的消息，测试通过 emit / status 模拟后端 */
const sent: ClientMessage[] = [];
let open = true;
let emit: (m: ServerMessage) => void = () => undefined;
let status: (s: ConnectionStatus) => void = () => undefined;

beforeAll(() => {
  startChatConnection((h) => {
    emit = h.onMessage;
    status = h.onStatus;
    return {
      send: (m) => (open ? (sent.push(m), true) : false),
      reconnect: () => undefined,
      close: () => undefined,
    };
  });
});

beforeEach(() => {
  sent.length = 0;
  vi.spyOn(sessionsApi, 'sessionPermission').mockResolvedValue({ permission: null });
  vi.spyOn(sessionsApi, 'saveSessionPermission').mockImplementation(
    async (_workspace, _session, _agent, permission) => ({ permission }),
  );
  open = true;
  useChat.setState(useChat.getInitialState(), true);
  useChat.getState().newSession('claude');
  useChat.setState({
    workspaceId: undefined,
    connection: 'open',
    modelOverrides: { claude: '', codex: '', antigravity: '' },
    reasoningEfforts: { claude: '', codex: '', antigravity: '' },
    sessionOperations: {},
    sessionModels: {},
    defaults: { defaultAgent: 'claude' },
    initialDefaultsEligible: false,
  });
  useChat.getState().selectWorkspace('w1');
});

it('具体会话的权限重新读取后恢复，保存期间禁止抢先发送，迟到保存不影响新会话', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_workspace, sessionId, agent) => ({
    session: { agent, sessionId, summary: '示例', lastModified: 1 },
    events: [],
  }));
  vi.mocked(sessionsApi.sessionPermission).mockResolvedValueOnce({ permission: { agent: 'codex', mode: 'ask' } });
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'saved' });
  expect(useChat.getState().permission).toEqual({ agent: 'codex', mode: 'ask' });
  const saving = deferred<{ permission: { agent: 'codex'; mode: 'auto-review' } }>();
  vi.mocked(sessionsApi.saveSessionPermission).mockReturnValueOnce(saving.promise);
  useChat.getState().setPermission({ agent: 'codex', mode: 'auto-review' });
  expect(useChat.getState().send('尚未保存')).toBe(false);
  const savedId = useChat.getState().conversationId;
  useChat.getState().newSession('claude');
  saving.resolve({ permission: { agent: 'codex', mode: 'auto-review' } });
  await saving.promise;
  await Promise.resolve();
  expect(useChat.getState().permission).toBeUndefined();
  expect(useChat.getState().banner).toBeUndefined();
  useChat.getState().openConversation(savedId);
  expect(useChat.getState().permission).toEqual({ agent: 'codex', mode: 'auto-review' });
  expect(useChat.getState().send('保存后发送')).toBe(true);
  expect(sent.at(-1)).toMatchObject({ permission: { agent: 'codex', mode: 'auto-review' } });
});

it('会话权限读取失败时不按未知权限发送，重新读取后可恢复', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue(history('codex', '示例'));
  vi.mocked(sessionsApi.sessionPermission).mockRejectedValueOnce(new Error('unavailable'));
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
  expect(useChat.getState().send('权限未知')).toBe(false);
  expect(useChat.getState().permissionError).toContain('权限');
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' }, { preserveDraft: true });
  expect(useChat.getState().send('恢复原生')).toBe(true);
});

it('会话权限保存失败保留旧选择并阻止发送，重置成功后没有额外提示', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue(history('claude', '示例'));
  vi.mocked(sessionsApi.sessionPermission).mockResolvedValueOnce({ permission: { agent: 'claude', mode: 'auto' } });
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'same-id' });
  vi.mocked(sessionsApi.saveSessionPermission).mockRejectedValueOnce(new Error('未保存'));
  useChat.getState().setPermission({ agent: 'claude', mode: 'plan' });
  await vi.waitFor(() => expect(useChat.getState().permissionSaving).toBe(false));
  expect(useChat.getState().permission).toEqual({ agent: 'claude', mode: 'auto' });
  expect(useChat.getState().permissionError).toContain('保存失败');
  expect(useChat.getState().send('不可发送')).toBe(false);
  useChat.getState().setPermission();
  await vi.waitFor(() => expect(useChat.getState().permissionSaving).toBe(false));
  expect(sessionsApi.saveSessionPermission).toHaveBeenLastCalledWith('w1', 'same-id', 'claude', null);
  expect(useChat.getState().permissionError).toBeUndefined();
  expect(useChat.getState().banner).toBeUndefined();
  expect(useChat.getState().send('原生默认')).toBe(true);
  expect(sent.at(-1)).not.toHaveProperty('permission');
});

it('Antigravity 无历史回放时仍恢复所属会话权限，新会话没有继承', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockRejectedValue(
    new ApiError(501, '不可回放', { code: 'session_not_replayable' }),
  );
  vi.mocked(sessionsApi.sessionPermission).mockResolvedValueOnce({
    permission: { agent: 'antigravity', mode: 'plan' },
  });
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'saved' });
  expect(useChat.getState().send('继续')).toBe(true);
  expect(sent.at(-1)).toMatchObject({ permission: { agent: 'antigravity', mode: 'plan' } });
  useChat.getState().newSession('antigravity');
  expect(useChat.getState().permission).toBeUndefined();
});

it.each(['claude', 'codex', 'antigravity'] as const)('未显式选择时%s发送省略模型与强度', (agent) => {
  useChat.getState().newSession(agent);
  expect(useChat.getState().send('沿用原生配置')).toBe(true);
  const payload = JSON.parse(JSON.stringify(sent.at(-1)));
  expect(payload).not.toHaveProperty('model');
  expect(payload).not.toHaveProperty('reasoningEffort');
});

it('历史读取失败后禁止发送，重新读取成功才允许续聊', async () => {
  const read = vi.spyOn(sessionsApi, 'sessionEvents').mockRejectedValueOnce(new Error('读取失败'));
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'same-id' });
  expect(useChat.getState().send('继续')).toBe(false);
  read.mockResolvedValue(history('claude', '历史'));
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'same-id' });
  expect(useChat.getState().send('继续')).toBe(true);
});

it('Antigravity不可回放保留会话身份并允许续接', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockRejectedValue(
    new ApiError(501, '私有轨迹无法回放', { code: 'session_not_replayable' }),
  );
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'agy-native' });
  expect(useChat.getState().send('接着处理')).toBe(true);
  expect(sent.at(-1)).toMatchObject({ agent: 'antigravity', sessionId: 'agy-native' });
});

it('运行中可离开并新建，后台输出和审批仍归属原会话', async () => {
  useChat.getState().setModel('selected-a');
  useChat.getState().setReasoningEffort('high');
  useChat.getState().setPermission({ agent: 'claude', mode: 'auto' });
  const turnId = startTurn('任务A');
  const firstId = useChat.getState().conversationId;
  useChat.getState().selectWorkspace('another');
  useChat.getState().newSession('codex');
  expect(useChat.getState().permission).toBeUndefined();
  expect(useChat.getState().send('任务B')).toBe(true);
  const second = sent.at(-1) as Extract<ClientMessage, { type: 'chat.send' }>;
  emit({
    type: 'turn.started',
    turnId: 'turn-b',
    clientTurnId: second.clientTurnId,
    workspaceId: 'another',
    agent: 'codex',
  });
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'session', sessionId: 'native-a', agent: 'claude', model: 'model-a', cwd: 'project' },
  });
  emit({ type: 'agent.event', turnId, event: { type: 'text', delta: 'A后台结果' } });
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'permission_request', requestId: 'approve-a', toolName: 'Bash', input: {} },
  });
  expect(useChat.getState()).toMatchObject({ workspaceId: 'another', agent: 'codex', turnId: 'turn-b', running: true });
  expect(JSON.stringify(useChat.getState().items)).not.toContain('A后台结果');
  expect(useChat.getState().background[firstId]).toMatchObject({ sessionId: 'native-a', running: true, unread: true });
  const read = vi.spyOn(sessionsApi, 'sessionEvents');
  useChat.getState().selectWorkspace('w1');
  await useChat.getState().openSession({ agent: 'claude', sessionId: 'native-a' });
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(useChat.getState().items)).toContain('A后台结果');
  expect(useChat.getState()).toMatchObject({
    modelOverrides: { claude: 'selected-a' },
    reasoningEfforts: { claude: 'high' },
    permission: { agent: 'claude', mode: 'auto' },
  });
  expect(useChat.getState().send('重复启动A')).toBe(false);
  useChat.getState().respondPermission('approve-a', true);
  expect(sent.at(-1)).toMatchObject({ type: 'permission.respond', turnId, requestId: 'approve-a', allow: true });
  useChat.getState().interrupt();
  expect(sent.at(-1)).toEqual({ type: 'chat.interrupt', turnId });
  expect(Object.values(useChat.getState().background).find((entry) => entry.turnId === 'turn-b')?.running).toBe(true);
});

it('历史加载时离开再返回会重新读取，迟到的旧结果不覆盖新结果和草稿', async () => {
  const pending = deferred<SessionHistory>();
  const read = vi
    .spyOn(sessionsApi, 'sessionEvents')
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(history('codex', '有效历史'));
  const firstLoad = useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
  const original = useChat.getState().conversationId;
  useChat.getState().setDraft('原会话草稿');
  useChat.getState().newSession('claude');
  expect(read.mock.calls[0]?.[3]?.aborted).toBe(true);
  useChat.getState().openConversation(original);
  await vi.waitFor(() => expect(useChat.getState().loadingHistory).toBe(false));
  pending.resolve(history('codex', '迟到旧历史'));
  await firstLoad;
  expect(useChat.getState()).toMatchObject({ conversationId: original, draft: '原会话草稿' });
  expect(JSON.stringify(useChat.getState().items)).toContain('有效历史');
  expect(JSON.stringify(useChat.getState().items)).not.toContain('迟到旧历史');
});

it('首次原生身份晚到时合并已从列表打开的同会话，取消旧历史并保留审批与草稿', async () => {
  const turnId = startTurn('任务A');
  const original = useChat.getState().conversationId;
  useChat.getState().newSession('codex');
  const pending = deferred<SessionHistory>();
  const read = vi.spyOn(sessionsApi, 'sessionEvents').mockReturnValue(pending.promise);
  const loading = useChat.getState().openSession({ agent: 'claude', sessionId: 'native-a' });
  useChat.getState().setDraft('待发送草稿');
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'session', sessionId: 'native-a', agent: 'claude', model: '', cwd: 'project' },
  });
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'permission_request', requestId: 'approve', toolName: 'Bash', input: {} },
  });
  expect(useChat.getState()).toMatchObject({
    conversationId: original,
    running: true,
    turnId,
    loadingHistory: false,
    draft: '待发送草稿',
  });
  expect(read.mock.calls[0]?.[3]?.aborted).toBe(true);
  expect(Object.values(useChat.getState().background).filter((view) => view.sessionId === 'native-a')).toHaveLength(0);
  expect(useChat.getState().send('禁止重复发送')).toBe(false);
  useChat.getState().respondPermission('approve', true);
  expect(sent.at(-1)).toMatchObject({ type: 'permission.respond', turnId, requestId: 'approve' });
  pending.resolve({
    session: { agent: 'claude', sessionId: 'native-a', summary: '临时历史', lastModified: 1 },
    events: [{ type: 'text', delta: '过时读取' }],
  });
  await loading;
  expect(JSON.stringify(useChat.getState().items)).not.toContain('过时读取');
  expect(useChat.getState().running).toBe(true);
});

it('后台会话完成后管理仍按目标检查，归档不会留下可续接的后台入口', async () => {
  const action = vi.spyOn(sessionsApi, 'sessionAction').mockResolvedValue(undefined);
  const turnId = startTurn('任务A');
  const first = useChat.getState().conversationId;
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'session', sessionId: 'native-a', agent: 'claude', model: '', cwd: 'project' },
  });
  useChat.getState().newSession('codex');
  const second = useChat.getState().conversationId;
  const session = { agent: 'claude', sessionId: 'native-a' } as const;
  expect(await useChat.getState().manageSession('w1', session, { action: 'archive' })).toBe(false);
  expect(action).not.toHaveBeenCalled();
  emit({ type: 'turn.finished', turnId, workspaceId: 'w1', agent: 'claude' });
  expect(await useChat.getState().manageSession('w1', session, { action: 'archive' })).toBe(true);
  expect(useChat.getState().background[first]).toBeUndefined();
  expect(useChat.getState().conversationId).toBe(second);
});

it('跨项目从普通列表返回已完成的AGY会话直接恢复内存，显式重读失败也不丢正文', async () => {
  useChat.getState().newSession('antigravity');
  const turnId = startTurn('AGY任务');
  const lastSentAt = useChat.getState().lastSentAt;
  expect(lastSentAt).toBeTypeOf('number');
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'session', sessionId: 'agy-native', agent: 'antigravity', model: 'native', cwd: 'project' },
  });
  useChat.getState().selectWorkspace('another');
  emit({ type: 'agent.event', turnId, event: { type: 'text', delta: '后台执行结果' } });
  emit({ type: 'turn.finished', turnId, workspaceId: 'w1', agent: 'antigravity' });
  const read = vi
    .spyOn(sessionsApi, 'sessionEvents')
    .mockRejectedValue(new ApiError(501, '不可回放', { code: 'session_not_replayable' }));
  useChat.getState().selectWorkspace('w1');
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'agy-native' });
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(useChat.getState().items)).toContain('后台执行结果');
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'agy-native' }, { preserveDraft: true });
  expect(JSON.stringify(useChat.getState().items)).toContain('后台执行结果');
  expect(useChat.getState().lastSentAt).toBe(lastSentAt);
  read.mockResolvedValue({
    session: { agent: 'antigravity', sessionId: 'agy-native', summary: '已保存', lastModified: 1 },
    events: [],
  });
  await useChat.getState().openSession({ agent: 'antigravity', sessionId: 'agy-native' }, { preserveDraft: true });
  expect(useChat.getState().lastSentAt).toBe(lastSentAt);
  useChat.getState().newSession('antigravity');
  expect(useChat.getState().lastSentAt).toBeUndefined();
});

it('空闲已读正文超过预算后按需重读，参数、草稿和不可回放内容保留', async () => {
  const read = vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_workspace, sessionId, agent) => ({
    session: { agent, sessionId, summary: sessionId, lastModified: 1 },
    events: [{ type: 'text', delta: `正文${sessionId}` }],
  }));
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'first' });
  const first = useChat.getState().conversationId;
  useChat.getState().setModel('selected-model');
  useChat.getState().setPermission({ agent: 'codex', mode: 'ask' });
  useChat.getState().newSession('antigravity');
  useChat.setState({
    sessionId: 'unreplayable',
    items: [{ kind: 'assistant', id: 'text', text: '唯一正文', streaming: false }],
    historyNotice: '不能回放',
  });
  const agy = useChat.getState().conversationId;
  useChat.getState().newSession('claude');
  useChat.getState().setDraft('不能丢的草稿');
  const draft = useChat.getState().conversationId;
  for (let index = 0; index < 12; index++)
    await useChat.getState().openSession({ agent: 'codex', sessionId: `later-${index}` });
  expect(useChat.getState().background[first]).toMatchObject({
    items: [],
    historyReloadNeeded: true,
    modelOverrides: { codex: 'selected-model' },
    permission: { agent: 'codex', mode: 'ask' },
  });
  expect(JSON.stringify(useChat.getState().background[agy]?.items)).toContain('唯一正文');
  expect(useChat.getState().background[draft]?.draft).toBe('不能丢的草稿');
  const calls = read.mock.calls.length;
  useChat.getState().openConversation(first);
  await vi.waitFor(() => expect(useChat.getState().loadingHistory).toBe(false));
  expect(read).toHaveBeenCalledTimes(calls + 1);
  expect(JSON.stringify(useChat.getState().items)).toContain('正文first');
});

it('准备期间离开后可找回和停止，迟到开始与结束不抢占新页面', () => {
  useChat.getState().send('准备A');
  const clientTurnId = useChat.getState().pendingClientTurnId!;
  const id = useChat.getState().conversationId;
  useChat.getState().newSession('antigravity');
  const current = useChat.getState().conversationId;
  useChat.getState().interruptConversation(id);
  emit({ type: 'turn.started', turnId: 'late', clientTurnId, workspaceId: 'w1', agent: 'claude' });
  expect(sent.at(-1)).toEqual({ type: 'chat.interrupt', turnId: 'late' });
  emit({ type: 'turn.finished', turnId: 'late', workspaceId: 'w1', agent: 'claude' });
  expect(useChat.getState().conversationId).toBe(current);
  expect(useChat.getState().background[id]).toMatchObject({
    running: false,
    pendingClientTurnId: undefined,
    unread: true,
  });
});

it('后台草稿与参数独立保存，断线收尾全部回合且不自动重发', () => {
  startTurn('任务A');
  const a = useChat.getState().conversationId;
  useChat.getState().setDraft('A后续草稿');
  useChat.getState().newSession('codex');
  useChat.getState().setDraft('B草稿');
  const b = useChat.getState().conversationId;
  useChat.getState().send('任务B');
  status('closed');
  expect(useChat.getState()).toMatchObject({ running: false, historyError: expect.any(String) });
  expect(useChat.getState().background[a]).toMatchObject({
    running: false,
    draft: 'A后续草稿',
    historyError: expect.any(String),
  });
  const count = sent.length;
  status('open');
  expect(sent).toHaveLength(count);
  expect(useChat.getState().conversationId).toBe(b);
});

it.each(['claude', 'codex', 'antigravity'] as const)('打开另一条%s会话不沿用上一会话的模型和强度', async (agent) => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_workspace, sessionId, source) => ({
    session: { agent: source, sessionId, summary: sessionId, lastModified: 1 },
    events: [],
  }));
  await useChat.getState().openSession({ agent, sessionId: 'session-a' });
  useChat.getState().setModel('old-model');
  useChat.getState().setReasoningEffort('high');
  await useChat.getState().openSession({ agent, sessionId: 'session-b' });
  expect(useChat.getState().send('沿用会话B的原生参数')).toBe(true);
  const payload = JSON.parse(JSON.stringify(sent.at(-1)));
  expect(payload).toMatchObject({ agent, sessionId: 'session-b' });
  expect(payload).not.toHaveProperty('model');
  expect(payload).not.toHaveProperty('reasoningEffort');
});

it('同会话重读保留显式参数，跨会话即使要求保留草稿也不继承', async () => {
  vi.spyOn(sessionsApi, 'sessionEvents').mockImplementation(async (_workspace, sessionId) => ({
    session: { agent: 'codex', sessionId, summary: sessionId, lastModified: 1 },
    events: [],
  }));
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'session-a' });
  useChat.getState().setModel('selected-model');
  useChat.getState().setReasoningEffort('low');
  const version = useChat.getState().conversationVersion;
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'session-a' }, { preserveDraft: true });
  expect(useChat.getState()).toMatchObject({
    conversationVersion: version,
    modelOverrides: { codex: 'selected-model' },
    reasoningEfforts: { codex: 'low' },
  });
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'session-b' }, { preserveDraft: true });
  expect(useChat.getState()).toMatchObject({ modelOverrides: { codex: '' }, reasoningEfforts: { codex: '' } });
});

it.each([
  {
    agent: 'antigravity' as const,
    error: new ApiError(501, '不能回放', { code: 'session_not_replayable' }),
    canSend: true,
  },
  { agent: 'codex' as const, error: new Error('暂时读不到'), canSend: false },
])('$agent 同会话重读失败保留已经收到的内存正文', async ({ agent, error, canSend }) => {
  const items = [{ kind: 'assistant' as const, id: 'received', text: '已经收到的结果', streaming: false }];
  useChat.setState({ agent, sessionId: 'same-id', items, historyError: '已断线' });
  vi.spyOn(sessionsApi, 'sessionEvents').mockRejectedValue(error);
  const reading = useChat.getState().openSession({ agent, sessionId: 'same-id' }, { preserveDraft: true });
  expect(useChat.getState().items).toEqual(items);
  await reading;
  expect(useChat.getState().items).toEqual(items);
  expect(useChat.getState().send('继续')).toBe(canSend);
});

it('视图代次只随选择变化，首次原生会话id和重选已打开会话不重置', async () => {
  const selected = useChat.getState().conversationVersion;
  useChat.getState().selectWorkspace('w1');
  expect(useChat.getState().conversationVersion).toBe(selected);
  useChat.getState().newSession('claude');
  expect(useChat.getState().conversationVersion).toBeGreaterThan(selected);
  const fresh = useChat.getState().conversationVersion;
  useChat.getState().setAgent('codex');
  expect(useChat.getState().conversationVersion).toBeGreaterThan(fresh);
  vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue(history('codex', '历史'));
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
  const firstOpen = useChat.getState().conversationVersion;
  await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
  expect(useChat.getState().conversationVersion).toBe(firstOpen);
  useChat.getState().newSession('claude');
  const live = useChat.getState().conversationVersion;
  const turnId = startTurn();
  emit({
    type: 'agent.event',
    turnId,
    event: { type: 'session', sessionId: 'first-native', model: 'example', cwd: 'project' },
  });
  expect(useChat.getState().sessionId).toBe('first-native');
  expect(useChat.getState().conversationVersion).toBe(live);
});

it.each(['claude', 'codex', 'antigravity'] as const)(
  '%s 新会话和结束事件更新列表，取消尚未完成的旧枚举',
  async (agent) => {
    useChat.getState().newSession(agent);
    const queryKey = sessionsKeys.sessions('w1', agent);
    const original = deferred<string[]>();
    let latest = ['native-session'];
    let originalSignal: AbortSignal | undefined;
    const observer = new QueryObserver(queryClient, {
      queryKey,
      staleTime: Infinity,
      retry: false,
      queryFn: ({ signal }) => {
        if (!originalSignal) {
          originalSignal = signal;
          return original.promise;
        }
        return Promise.resolve(latest);
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      const turnId = startTurn();
      emit({
        type: 'agent.event',
        turnId,
        event: { type: 'session', agent, sessionId: 'native-session', model: '', cwd: 'project' },
      });
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['native-session']));
      expect(originalSignal?.aborted).toBe(true);
      latest = ['updated-native-session'];
      emit({ type: 'turn.finished', turnId, workspaceId: 'w1', agent });
      await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(['updated-native-session']));
      expect(useChat.getState().running).toBe(false);
    } finally {
      original.resolve(['obsolete-session']);
      unsubscribe();
      await queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    }
  },
);

describe('原生会话管理状态', () => {
  const session = { agent: 'codex', sessionId: 'same-id' } as const;
  const key = sessionActionKey('w1', session);
  const removeActions = [{ action: 'delete', confirmed: true }, { action: 'archive' }] satisfies SessionActionInput[];

  beforeEach(() => {
    useChat.setState({ ...session, items: [{ kind: 'user', id: 'message-current', text: '当前对话' }] });
    vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  });

  it('处理中拒绝同目标重复操作和发送，名称保存成功后保留对话', async () => {
    const response = deferred<void>();
    const action = vi.spyOn(sessionsApi, 'sessionAction').mockReturnValue(response.promise);
    const request = useChat.getState().manageSession('w1', session, { action: 'rename', title: '新名称' });
    expect(useChat.getState().sessionOperations[key]).toEqual({ action: 'rename', pending: true });
    await expect(useChat.getState().manageSession('w1', session, { action: 'delete', confirmed: true })).resolves.toBe(
      false,
    );
    expect(useChat.getState().send('等待名称保存')).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);

    response.resolve();
    await expect(request).resolves.toBe(true);
    expect(useChat.getState()).toMatchObject({ ...session, items: [{ kind: 'user', text: '当前对话' }] });
    expect(useChat.getState().sessionOperations[key]).toBeUndefined();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ predicate: expect.any(Function) });
    expect(useChat.getState().send('继续')).toBe(true);
  });

  it('运行中不发管理请求；后端失败保留会话和错误并解除处理中状态', async () => {
    const action = vi.spyOn(sessionsApi, 'sessionAction').mockRejectedValue(new Error('原生操作失败'));
    useChat.setState({ running: true });
    await expect(useChat.getState().manageSession('w1', session, { action: 'archive' })).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
    useChat.setState({ running: false });
    await expect(useChat.getState().manageSession('w1', session, { action: 'archive' })).resolves.toBe(false);
    expect(useChat.getState()).toMatchObject({ ...session, items: [{ kind: 'user', text: '当前对话' }] });
    expect(useChat.getState().sessionOperations[key]).toEqual({
      action: 'archive',
      pending: false,
      error: '原生操作失败',
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(useChat.getState().send('失败后继续')).toBe(true);
  });

  it('归档时另一项目首次加载被取消后重新读取，不停留在 pending/idle', async () => {
    vi.mocked(queryClient.invalidateQueries).mockRestore();
    vi.spyOn(sessionsApi, 'sessionAction').mockResolvedValue(undefined);
    const queryKey = sessionsKeys.sessions('other-loading', 'codex');
    const unrelatedKey = sessionsKeys.sessions('other-loading', 'claude');
    const original = deferred<string[]>();
    let originalSignal: AbortSignal | undefined;
    const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
      originalSignal ??= signal;
      return read.mock.calls.length === 1 ? original.promise : Promise.resolve(['latest-session']);
    });
    queryClient.setQueryData(unrelatedKey, ['unrelated-session']);
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: read, retry: false, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      expect(read).toHaveBeenCalledTimes(1);
      expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', fetchStatus: 'fetching' });
      await expect(useChat.getState().manageSession('w1', session, { action: 'archive' })).resolves.toBe(true);
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(originalSignal?.aborted).toBe(true);
      await vi.waitFor(() =>
        expect(observer.getCurrentResult()).toMatchObject({ status: 'success', data: ['latest-session'] }),
      );
      expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
    } finally {
      original.resolve(['obsolete-session']);
      unsubscribe();
      await queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
      queryClient.removeQueries({ queryKey: unrelatedKey });
    }
  });

  it.each(removeActions)('$action 成功时清空仍匹配的当前对话并刷新来源列表', async (input) => {
    useChat.getState().setModel('old-model');
    useChat.getState().setReasoningEffort('high');
    vi.spyOn(sessionsApi, 'sessionAction').mockResolvedValue(undefined);
    await expect(useChat.getState().manageSession('w1', session, input)).resolves.toBe(true);
    expect(useChat.getState()).toMatchObject({ workspaceId: 'w1', agent: 'codex', sessionId: undefined, items: [] });
    expect(useChat.getState().sessionOperations[key]).toBeUndefined();
    expect(useChat.getState().modelOverrides.codex).toBe('');
    expect(useChat.getState().reasoningEfforts.codex).toBe('');
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ predicate: expect.any(Function) });
  });

  it.each([
    { dimension: '工作区', workspaceId: 'w2', agent: 'codex', sessionId: 'same-id', input: removeActions[0]! },
    { dimension: 'Agent', workspaceId: 'w1', agent: 'claude', sessionId: 'same-id', input: removeActions[1]! },
    { dimension: '会话 ID', workspaceId: 'w1', agent: 'codex', sessionId: 'new-id', input: removeActions[0]! },
  ] as const)(
    '跨 $dimension 切换后保留原请求，迟到成功不清空新对话',
    async ({ workspaceId, agent, sessionId, input }) => {
      const response = deferred<void>();
      vi.spyOn(sessionsApi, 'sessionAction').mockReturnValue(response.promise);
      const request = useChat.getState().manageSession('w1', session, input);
      useChat.getState().selectWorkspace(workspaceId);
      useChat.getState().newSession(agent);
      useChat.setState({ sessionId });
      expect(useChat.getState().sessionOperations[key]?.pending).toBe(true);
      expect(useChat.getState().send('新目标可以发送')).toBe(true);

      response.resolve();
      await expect(request).resolves.toBe(true);
      expect(useChat.getState()).toMatchObject({
        workspaceId,
        agent,
        sessionId,
        running: true,
        items: [{ kind: 'user', text: '新目标可以发送' }],
      });
      expect(useChat.getState().sessionOperations[key]).toBeUndefined();
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ predicate: expect.any(Function) });
    },
  );
});

/** 发送一条消息并让后端确认开始，返回 turnId */
function startTurn(text = '你好'): string {
  useChat.getState().send(text);
  const msg = sent.at(-1) as Extract<ClientMessage, { type: 'chat.send' }>;
  emit({
    type: 'turn.started',
    turnId: 't1',
    clientTurnId: msg.clientTurnId,
    workspaceId: 'w1',
    agent: useChat.getState().agent,
  });
  return 't1';
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function history(agent: AgentKind, text: string): SessionHistory {
  return {
    session: { agent, sessionId: 'same-id', summary: text, lastModified: 1 },
    events: [{ type: 'text', delta: text }],
    actualModel: 'native-model',
  };
}

describe('原生能力状态', () => {
  const skill: AgentCapability = {
    id: 'skill-demo',
    kind: 'skill',
    name: 'demo',
    description: '演示技能',
    source: '项目',
    available: true,
    requiresSession: false,
    supportsArguments: true,
  };

  it('仅技能可发送，连接不接受时保留选择，接受后只传 ID 并清理选择', () => {
    useChat.getState().selectCapability(skill);
    open = false;
    expect(useChat.getState().send('')).toBe(false);
    expect(useChat.getState().selectedCapability).toEqual(skill);
    expect(useChat.getState().items).toEqual([]);
    open = true;
    expect(useChat.getState().send('')).toBe(true);
    expect(sent[0]).toMatchObject({ type: 'chat.send', text: '', selection: { id: skill.id } });
    expect((sent[0] as Extract<ClientMessage, { type: 'chat.send' }>).selection).toEqual({ id: skill.id });
    expect(useChat.getState().selectedCapability).toBeUndefined();
    expect(useChat.getState().items).toMatchObject([{ kind: 'user', text: '/demo' }]);
  });

  it('禁用项和缺少会话的命令不能选择，无参数命令与管理中的目标不能发送', () => {
    const compact = {
      ...skill,
      id: 'command-compact',
      kind: 'command' as const,
      name: 'compact',
      requiresSession: true,
      supportsArguments: false,
    };
    useChat.getState().selectCapability({ ...skill, available: false, unavailableReason: 'CLI 专用' });
    expect(useChat.getState().selectedCapability).toBeUndefined();
    useChat.getState().selectCapability(compact);
    expect(useChat.getState().selectedCapability).toBeUndefined();
    useChat.setState({ sessionId: 'native-id' });
    useChat.getState().selectCapability(compact);
    expect(useChat.getState().send('不支持的参数')).toBe(false);
    expect(useChat.getState().selectedCapability).toEqual(compact);
    const key = sessionActionKey('w1', { agent: 'claude', sessionId: 'native-id' });
    useChat.setState({ sessionOperations: { [key]: { action: 'rename', pending: true } } });
    expect(useChat.getState().send('')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('工作区、Agent 与原生会话切换均清理所选能力', async () => {
    useChat.getState().selectCapability(skill);
    useChat.getState().selectWorkspace('w2');
    expect(useChat.getState().selectedCapability).toBeUndefined();
    useChat.getState().selectCapability(skill);
    useChat.getState().setAgent('codex');
    expect(useChat.getState().selectedCapability).toBeUndefined();
    useChat.getState().selectCapability(skill);
    vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue(history('codex', '已有会话'));
    await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    expect(useChat.getState().selectedCapability).toBeUndefined();
  });

  it('上下文保留原生字段和不可用状态，切换后忽略旧轮次状态', () => {
    const turnId = startTurn();
    const usage = { source: 'codex_native' as const, usedTokens: 200, windowTokens: 1000 };
    emit({ type: 'agent.event', turnId, event: { type: 'context', usage } });
    expect(useChat.getState().contextUsage).toEqual(usage);
    expect(useChat.getState().contextUsage).not.toHaveProperty('percentage');
    emit({ type: 'agent.event', turnId, event: { type: 'context', usage: null } });
    expect(useChat.getState().contextUsage).toBeNull();
    emit({ type: 'turn.finished', turnId, workspaceId: 'w1', agent: 'claude' });
    useChat.getState().selectWorkspace('w2');
    emit({ type: 'agent.event', turnId, event: { type: 'context', usage } });
    emit({ type: 'agent.event', turnId, event: { type: 'compaction', state: { status: 'completed' } } });
    expect(useChat.getState()).toMatchObject({ contextUsage: undefined, compaction: undefined });
  });

  it('历史保留原生压缩边界，不从候选或执行报告推导模型与强度', async () => {
    useChat.getState().newSession('codex');
    queryClient.setQueryData(chatKeys.agentCapabilities('w1', 'codex'), {
      agent: 'codex',
      entries: [],
      warnings: [],
      models: [{ id: 'catalog-model', label: '候选', reasoningEfforts: ['low'] }],
    });
    vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue({
      ...history('codex', '原生历史'),
      events: [
        { type: 'compaction', state: { status: 'completed', trigger: 'manual', beforeTokens: 500, afterTokens: 100 } },
      ],
    });
    await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    expect(useChat.getState().items).toMatchObject([
      { kind: 'compaction', state: { status: 'completed', beforeTokens: 500, afterTokens: 100 } },
    ]);
    expect(useChat.getState().contextUsage).toBeUndefined();
    expect(useChat.getState().send('继续')).toBe(true);
    expect(sent[0]).toMatchObject({ agent: 'codex', model: undefined, reasoningEffort: undefined });
    expect(useChat.getState().compaction).toMatchObject({ status: 'completed' });
    queryClient.removeQueries({ queryKey: chatKeys.agentCapabilities('w1', 'codex') });
  });

  it('断线后保留未确认边界，重新读取前不能继续发送', () => {
    const turnId = startTurn('压缩当前会话');
    emit({
      type: 'agent.event',
      turnId,
      event: { type: 'compaction', state: { status: 'running', trigger: 'manual' } },
    });
    status('connecting');
    const boundary = useChat.getState().items.find((item) => item.kind === 'compaction');
    expect(boundary).toMatchObject({ state: { status: 'running' }, incomplete: true });
    status('open');
    expect(useChat.getState().send('继续普通对话')).toBe(false);
    expect(useChat.getState().items.find((item) => item.kind === 'compaction')).toEqual(boundary);
  });
});

describe('chat-store', () => {
  it('产品偏好只选择初始Agent，新会话清空显式模型并沿用原生默认', () => {
    useChat.setState({ initialDefaultsEligible: true });
    useChat.getState().setDefaults(ProductSettingsSchema.parse({ defaultAgent: 'codex' }));
    expect(useChat.getState()).toMatchObject({ agent: 'codex', modelOverrides: { claude: '', codex: '' } });
    expect(useChat.getState().send('初始会话')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ agent: 'codex', reasoningEffort: undefined, model: undefined });
    useChat.getState().setModel('explicit-model');
    useChat.getState().setDefaults(ProductSettingsSchema.parse({ defaultAgent: 'claude' }));
    expect(useChat.getState()).toMatchObject({ agent: 'codex', modelOverrides: { codex: 'explicit-model' } });
    finishTurn();
    useChat.getState().newSession();
    expect(useChat.getState()).toMatchObject({ agent: 'claude', modelOverrides: { claude: '', codex: '' } });
    expect(useChat.getState().send('新会话')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ agent: 'claude', model: undefined, reasoningEffort: undefined });
  });

  it('迟到产品偏好不覆盖已操作的Agent、模型和强度草稿', () => {
    useChat.setState({ initialDefaultsEligible: true });
    useChat.getState().touchDraft();
    useChat.getState().setModel('explicit-model');
    useChat.getState().setReasoningEffort('low');
    useChat.getState().setDefaults(ProductSettingsSchema.parse({ defaultAgent: 'codex' }));
    expect(useChat.getState().send('保留草稿选择')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ agent: 'claude', model: 'explicit-model', reasoningEffort: 'low' });
  });

  it('历史原生配置和实际报告只更新证据，明确重置后续接不带model', async () => {
    const session = { agent: 'codex' as const, sessionId: 'history', summary: '历史', lastModified: 1 };
    vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue({
      session: { ...session, nativeModel: 'native-config-model' },
      events: [],
      actualModel: 'historical-model',
    });
    await useChat.getState().openSession(session);
    expect(useChat.getState().modelOverrides.codex).toBe('');
    expect(useChat.getState().sessionModels[sessionActionKey('w1', session)]).toEqual({
      actualModel: 'historical-model',
      nativeModel: 'native-config-model',
    });
    useChat.getState().setModel('explicit-model');
    await useChat.getState().openSession(session);
    expect(useChat.getState().modelOverrides.codex).toBe('explicit-model');
    useChat.getState().setModel('');
    expect(useChat.getState().send('重置后沿用原生')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ agent: 'codex', sessionId: 'history', model: undefined });
    expect(JSON.parse(JSON.stringify(sent.at(-1)))).not.toHaveProperty('model');
  });

  it('运行报告保留历史原生配置证据，不回填用户覆盖', async () => {
    const session = { agent: 'claude' as const, sessionId: 'same-id' };
    vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue({
      ...history('claude', '历史'),
      session: { ...history('claude', '历史').session, nativeModel: 'native-config-model' },
    });
    await useChat.getState().openSession(session);
    useChat.getState().setModel('explicit-model');
    const turnId = startTurn('继续');
    emit({ type: 'agent.event', turnId, event: { type: 'session', ...session, cwd: '.', model: 'reported-model' } });
    expect(useChat.getState().sessionModels[sessionActionKey('w1', session)]).toEqual({
      nativeModel: 'native-config-model',
      actualModel: 'reported-model',
    });
    emit({ type: 'agent.event', turnId, event: { type: 'session', ...session, cwd: '.', model: ' ' } });
    expect(useChat.getState().modelOverrides.claude).toBe('explicit-model');
    expect(useChat.getState().actualModel).toBeUndefined();
    expect(useChat.getState().sessionModels[sessionActionKey('w1', session)]?.nativeModel).toBe('native-config-model');
  });
  it('选择工作区时记住它，并清空当前会话', () => {
    expect(lastWorkspaceId()).toBe('w1');
    expect(useChat.getState()).toMatchObject({ workspaceId: 'w1', items: [], running: false });
  });

  it('发送：模型留空时不传 model，用户消息立即显示', () => {
    useChat.getState().send('你好');
    expect(sent[0]).toMatchObject({ type: 'chat.send', workspaceId: 'w1', text: '你好', model: undefined });
    expect(useChat.getState()).toMatchObject({ running: true, items: [{ kind: 'user', text: '你好' }] });
  });

  it('填写模型时随消息发送', () => {
    useChat.getState().setModel('  opus  ');
    useChat.getState().send('x');
    expect(sent[0]).toMatchObject({ model: 'opus' });
  });

  it('运行中不能再次发送；断开时提示未发送', () => {
    startTurn();
    useChat.getState().send('再来');
    expect(sent).toHaveLength(1);

    useChat.setState({ running: false });
    open = false;
    useChat.getState().send('断开时');
    expect(useChat.getState().banner).toContain('未发送');
  });

  it('运行时模型按工作区和来源缓存，选择值不冒充报告；空报告清除旧值', () => {
    useChat.getState().setModel('requested');
    const turnId = startTurn();
    const key = sessionActionKey('w1', { agent: 'claude', sessionId: 's1' });
    expect(useChat.getState().sessionModels?.[key]).toBeUndefined();
    emit({ type: 'agent.event', turnId, event: { type: 'session', sessionId: 's1', model: ' actual ', cwd: '/' } });
    expect(useChat.getState().sessionModels?.[key]).toMatchObject({ actualModel: 'actual' });
    emit({ type: 'agent.event', turnId, event: { type: 'session', sessionId: 's1', model: ' ', cwd: '/' } });
    expect(useChat.getState().actualModel).toBeUndefined();
    expect(useChat.getState().sessionModels?.[key]?.actualModel).toBeUndefined();
  });
  it('只接收当前轮的事件；session 事件更新会话与模型；结束后停止运行', () => {
    const turnId = startTurn();
    emit({ type: 'agent.event', turnId: 'other', event: { type: 'text', delta: '别的' } });
    emit({ type: 'agent.event', turnId, event: { type: 'session', sessionId: 's1', model: 'm1', cwd: '/' } });
    emit({ type: 'agent.event', turnId, event: { type: 'text', delta: '答' } });
    emit({ type: 'turn.finished', turnId, workspaceId: 'w1', agent: 'claude' });

    const s = useChat.getState();
    expect(s).toMatchObject({ sessionId: 's1', actualModel: 'm1', running: false, turnId: undefined });
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'assistant']);
    expect(s.items[1]).toMatchObject({ text: '答', streaming: false });
  });

  it('轮次开始前的错误（如会话正在运行）结束等待并显示横幅', () => {
    useChat.getState().send('x');
    const current = sent.at(-1) as Extract<ClientMessage, { type: 'chat.send' }>;
    emit({ type: 'error', clientTurnId: 'old-request', message: '旧轮次错误' });
    emit({ type: 'error', message: '无关联错误' });
    expect(useChat.getState()).toMatchObject({ running: true, pendingClientTurnId: current.clientTurnId });
    emit({ type: 'error', clientTurnId: current.clientTurnId, message: '该会话正在运行' });
    expect(useChat.getState()).toMatchObject({ running: false, banner: '该会话正在运行' });
    useChat.getState().send('下一轮');
    const next = sent.at(-1) as Extract<ClientMessage, { type: 'chat.send' }>;
    emit({ type: 'error', turnId: 'old-turn', clientTurnId: current.clientTurnId, message: '旧启动失败' });
    expect(useChat.getState()).toMatchObject({
      running: true,
      pendingClientTurnId: next.clientTurnId,
      banner: undefined,
    });
    emit({ type: 'error', turnId: 'allocated', clientTurnId: next.clientTurnId, message: '启动失败' });
    expect(useChat.getState()).toMatchObject({ running: false, pendingClientTurnId: undefined, banner: '启动失败' });
  });

  it('其他轮次的错误忽略，本轮的错误显示横幅', () => {
    const turnId = startTurn();
    emit({ type: 'error', turnId: 'other', message: '别的' });
    expect(useChat.getState().banner).toBeUndefined();
    emit({ type: 'error', turnId, message: '出错' });
    expect(useChat.getState()).toMatchObject({ banner: '出错', running: true });
  });

  it('运行中断线：结束运行并提示输出可能不完整', () => {
    const turnId = startTurn();
    emit({
      type: 'agent.event',
      turnId,
      event: { type: 'permission_request', requestId: 'old-approval', toolName: 'command', input: {} },
    });
    status('connecting');
    expect(useChat.getState()).toMatchObject({ running: false, connection: 'connecting' });
    expect(useChat.getState().banner).toContain('不完整');
    expect(useChat.getState().items.at(-1)).toMatchObject({ resolved: 'cancelled' });
    status('open');
    useChat.getState().respondPermission('old-approval', true);
    expect(sent).toHaveLength(1);
  });

  it('中断与权限答复发送对应消息', () => {
    const turnId = startTurn();
    emit({
      type: 'agent.event',
      turnId,
      event: { type: 'permission_request', requestId: 'p1', toolName: 'Bash', input: {} },
    });
    useChat.getState().respondPermission('p1', false);
    expect(useChat.getState().items.at(-1)).toMatchObject({ responding: true });
    expect(useChat.getState().items.at(-1)).not.toHaveProperty('resolved');
    useChat.getState().respondPermission('p1', true);
    emit({ type: 'agent.event', turnId, event: { type: 'permission_resolved', requestId: 'p1', decision: 'denied' } });
    useChat.getState().interrupt();
    expect(sent.slice(1)).toEqual([
      { type: 'permission.respond', turnId, requestId: 'p1', allow: false },
      { type: 'chat.interrupt', turnId },
    ]);
    expect(useChat.getState().items.at(-1)).toMatchObject({ kind: 'permission', resolved: 'deny' });
  });

  it('模型覆盖按 Agent 隔离，历史固定原 Agent 并用其官方 ID 续接', async () => {
    useChat.getState().setModel('claude-model');
    useChat.getState().setAgent('codex');
    useChat.getState().setModel('codex-model');
    useChat.getState().setReasoningEffort('high');
    vi.spyOn(sessionsApi, 'sessionEvents').mockResolvedValue(history('codex', '原生历史'));
    await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    useChat.getState().setAgent('claude');
    expect(useChat.getState()).toMatchObject({
      agent: 'codex',
      actualModel: 'native-model',
      modelOverrides: { claude: '', codex: '' },
    });
    useChat.getState().setModel('codex-model');
    useChat.getState().setReasoningEffort('high');
    useChat.getState().send('续接');
    expect(sent.at(-1)).toMatchObject({
      agent: 'codex',
      sessionId: 'same-id',
      model: 'codex-model',
      reasoningEffort: 'high',
    });
    finishTurn();
    useChat.getState().newSession('claude');
    useChat.getState().send('新会话');
    expect(sent.at(-1)).toMatchObject({
      agent: 'claude',
      model: undefined,
      reasoningEffort: undefined,
      sessionId: undefined,
    });
  });

  it.each(['success', 'error'] as const)('跨 Agent 同 ID 与重复选择时忽略迟到历史 %s，加载期间禁发', async (result) => {
    const old = deferred<SessionHistory>();
    const middle = deferred<SessionHistory>();
    const latest = deferred<SessionHistory>();
    const read = vi
      .spyOn(sessionsApi, 'sessionEvents')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(latest.promise);
    const first = useChat.getState().openSession({ agent: 'claude', sessionId: 'same-id' });
    expect(useChat.getState().send('不能发')).toBe(false);
    const second = useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    const third = useChat.getState().openSession({ agent: 'claude', sessionId: 'same-id' });
    expect(read.mock.calls[0]?.[3]?.aborted).toBe(true);
    expect(read.mock.calls[1]?.[3]?.aborted).toBe(true);
    middle.resolve(history('codex', '迟到 Codex'));
    if (result === 'success') old.resolve(history('claude', '迟到 Claude'));
    else old.reject(new Error('迟到错误'));
    await Promise.all([first, second]);
    expect(useChat.getState()).toMatchObject({ loadingHistory: true, items: [], banner: undefined });
    latest.resolve(history('claude', '最新历史'));
    await third;
    expect(useChat.getState().items).toMatchObject([{ text: '最新历史' }]);
    expect(sent).toHaveLength(0);
  });

  it('工作区切换取消历史，并在后台轮次结束时刷新其原 Agent 列表', async () => {
    const pending = deferred<SessionHistory>();
    vi.spyOn(sessionsApi, 'sessionEvents').mockReturnValue(pending.promise);
    const loading = useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    useChat.getState().selectWorkspace('w2');
    pending.resolve(history('codex', '旧工作区'));
    await loading;
    expect(useChat.getState()).toMatchObject({ workspaceId: 'w2', items: [], sessionId: undefined });
    const refresh = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    useChat.getState().send('新工作区');
    emit({ type: 'turn.finished', turnId: 'background', workspaceId: 'w1', agent: 'codex' });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith({ predicate: expect.any(Function) }));
    const filter = refresh.mock.lastCall?.[0]?.predicate;
    const lists = queryClient.getQueryCache();
    queryClient.setQueryData(sessionsKeys.sessions('w1', 'codex'), []);
    queryClient.setQueryData(sessionsKeys.sessions('w2', 'claude'), []);
    expect(filter?.(lists.find({ queryKey: sessionsKeys.sessions('w1', 'codex') })!)).toBe(true);
    expect(filter?.(lists.find({ queryKey: sessionsKeys.sessions('w2', 'claude') })!)).toBe(false);
    expect(useChat.getState().running).toBe(true);
  });

  it('轮次尚未返回 ID 时保留停止意图，切换视图后只停止原回合', () => {
    useChat.getState().setAgent('codex');
    useChat.getState().send('开始');
    const request = sent[0] as Extract<ClientMessage, { type: 'chat.send' }>;
    const original = useChat.getState().conversationId;
    useChat.getState().interrupt();
    useChat.getState().interrupt();
    expect(sent).toHaveLength(1);
    useChat.getState().newSession('claude');
    emit({
      type: 'turn.started',
      turnId: 'old-turn',
      clientTurnId: request.clientTurnId,
      workspaceId: 'w1',
      agent: 'codex',
    });
    expect(sent.at(-1)).toEqual({ type: 'chat.interrupt', turnId: 'old-turn' });
    expect(useChat.getState()).toMatchObject({ agent: 'claude', running: false, turnId: undefined });
    expect(useChat.getState().background[original]).toMatchObject({
      agent: 'codex',
      running: true,
      turnId: 'old-turn',
    });
  });
});

it('Claude与Codex推理强度隔离，切回恢复选择且发送真实字段', () => {
  useChat.getState().setModel('claude-supported');
  useChat.getState().setReasoningEffort('high');
  useChat.getState().setAgent('codex');
  useChat.getState().setReasoningEffort('low');
  useChat.getState().setAgent('claude');
  expect(useChat.getState().send('Claude正文')).toBe(true);
  expect(sent.at(-1)).toMatchObject({ agent: 'claude', model: 'claude-supported', reasoningEffort: 'high' });
  useChat.setState({ running: false, pendingClientTurnId: undefined });
  useChat.getState().setAgent('codex');
  expect(useChat.getState().send('Codex正文')).toBe(true);
  expect(sent.at(-1)).toMatchObject({ agent: 'codex', reasoningEffort: 'low' });
});

it.each(['claude', 'codex', 'antigravity'] as const)('新建%s会话清空旧强度覆盖', (agent) => {
  useChat.getState().setReasoningEffort('low');
  useChat.getState().newSession(agent);
  expect(useChat.getState().send('新会话默认')).toBe(true);
  expect(sent.at(-1)).toMatchObject({ agent, reasoningEffort: undefined });
});

/** 完成真实协议中的准备和结束阶段，让下一条操作使用已收尾的会话。 */
function finishTurn() {
  const current = useChat.getState();
  const turnId = current.turnId ?? 'finished-test-turn';
  if (current.pendingClientTurnId)
    emit({
      type: 'turn.started',
      turnId,
      clientTurnId: current.pendingClientTurnId,
      workspaceId: current.workspaceId!,
      agent: current.agent,
    });
  emit({ type: 'turn.finished', turnId, workspaceId: current.workspaceId!, agent: current.agent });
}

it('权限只作用于当前会话，运行中锁定，新建和跨CLI选择不继承', () => {
  useChat.getState().setPermission({ agent: 'claude', mode: 'auto' });
  useChat.getState().send('带权限选择');
  expect(sent.at(-1)).toMatchObject({ permission: { agent: 'claude', mode: 'auto' } });
  useChat.getState().setPermission({ agent: 'claude', mode: 'bypassPermissions' });
  expect(useChat.getState().permission).toEqual({ agent: 'claude', mode: 'auto' });
  useChat.setState({ running: false, pendingClientTurnId: undefined });
  useChat.getState().newSession('codex');
  expect(useChat.getState().permission).toBeUndefined();
  useChat.getState().setPermission({ agent: 'claude', mode: 'auto' });
  expect(useChat.getState().permission).toBeUndefined();
  useChat.getState().setPermission({ agent: 'codex', mode: 'auto-review' });
  useChat.getState().setPermission(undefined);
  useChat.getState().send('清除覆盖');
  expect(JSON.parse(JSON.stringify(sent.at(-1)))).not.toHaveProperty('permission');
});
