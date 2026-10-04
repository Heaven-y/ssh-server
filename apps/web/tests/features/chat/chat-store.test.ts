import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductSettingsSchema } from '@ssh-server/shared';
import type {
  AgentCapability,
  AgentKind,
  ClientMessage,
  ServerMessage,
  SessionActionInput,
  SessionHistory,
} from '@ssh-server/shared';
import type { ConnectionStatus } from '../../../src/lib/ws';

// node 环境没有 localStorage，用内存实现
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
});

const { useChat, startChatConnection, lastWorkspaceId, sessionActionKey } =
  await import('../../../src/features/chat/chat-store');
const { api, queryKeys } = await import('../../../src/lib/api');
const { queryClient } = await import('../../../src/lib/query-client');
afterEach(() => {
  vi.restoreAllMocks();
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
  open = true;
  useChat.getState().newSession('claude');
  useChat.setState({
    workspaceId: undefined,
    connection: 'open',
    modelOverrides: { claude: '', codex: '' },
    reasoningEffort: '',
    sessionOperations: {},
    defaults: { defaultAgent: 'claude', defaultModels: { claude: '', codex: '' } },
    modelSources: { claude: 'default', codex: 'default' },
    initialDefaultsEligible: false,
  });
  useChat.getState().selectWorkspace('w1');
});

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
    const action = vi.spyOn(api, 'sessionAction').mockReturnValue(response.promise);
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
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.sessions('w1', 'codex') });
    expect(useChat.getState().send('继续')).toBe(true);
  });

  it('运行中不发管理请求；后端失败保留会话和错误并解除处理中状态', async () => {
    const action = vi.spyOn(api, 'sessionAction').mockRejectedValue(new Error('原生操作失败'));
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

  it.each(removeActions)('$action 成功时清空仍匹配的当前对话并刷新来源列表', async (input) => {
    vi.spyOn(api, 'sessionAction').mockResolvedValue(undefined);
    await expect(useChat.getState().manageSession('w1', session, input)).resolves.toBe(true);
    expect(useChat.getState()).toMatchObject({ workspaceId: 'w1', agent: 'codex', sessionId: undefined, items: [] });
    expect(useChat.getState().sessionOperations[key]).toBeUndefined();
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.sessions('w1', 'codex') });
  });

  it.each([
    { dimension: '工作区', workspaceId: 'w2', agent: 'codex', sessionId: 'same-id', input: removeActions[0]! },
    { dimension: 'Agent', workspaceId: 'w1', agent: 'claude', sessionId: 'same-id', input: removeActions[1]! },
    { dimension: '会话 ID', workspaceId: 'w1', agent: 'codex', sessionId: 'new-id', input: removeActions[0]! },
  ] as const)(
    '跨 $dimension 切换后保留原请求，迟到成功不清空新对话',
    async ({ workspaceId, agent, sessionId, input }) => {
      const response = deferred<void>();
      vi.spyOn(api, 'sessionAction').mockReturnValue(response.promise);
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
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.sessions('w1', 'codex') });
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
    vi.spyOn(api, 'sessionEvents').mockResolvedValue(history('codex', '已有会话'));
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
    useChat.getState().selectWorkspace('w2');
    emit({ type: 'agent.event', turnId, event: { type: 'context', usage } });
    emit({ type: 'agent.event', turnId, event: { type: 'compaction', state: { status: 'completed' } } });
    expect(useChat.getState()).toMatchObject({ contextUsage: undefined, compaction: undefined });
  });

  it('历史保留原生压缩边界，不把候选或实际模型写成模型与推理覆盖', async () => {
    useChat.getState().newSession('codex');
    queryClient.setQueryData(queryKeys.agentCapabilities('w1', 'codex'), {
      agent: 'codex',
      entries: [],
      warnings: [],
      models: [{ id: 'catalog-model', label: '候选', reasoningEfforts: ['high'] }],
    });
    vi.spyOn(api, 'sessionEvents').mockResolvedValue({
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
    queryClient.removeQueries({ queryKey: queryKeys.agentCapabilities('w1', 'codex') });
  });

  it('断线后的普通新轮次不复活旧压缩，历史仍保留未确认边界', () => {
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
    expect(useChat.getState().send('继续普通对话')).toBe(true);
    expect(useChat.getState().compaction).toBeUndefined();
    expect(useChat.getState().items.find((item) => item.kind === 'compaction')).toEqual(boundary);
  });
});

describe('chat-store', () => {
  it('新会话应用产品默认，迟到偏好保护操作草稿，历史只保留显式模型', async () => {
    const defaults = ProductSettingsSchema.parse({
      defaultAgent: 'codex',
      defaultModels: { claude: 'example-claude', codex: 'example-codex' },
    });
    useChat.setState({ initialDefaultsEligible: true });
    useChat.getState().setDefaults(defaults);
    expect(useChat.getState()).toMatchObject({ agent: 'codex', modelOverrides: defaults.defaultModels });
    useChat.getState().touchDraft();
    useChat.getState().setDefaults({ ...defaults, defaultAgent: 'claude' });
    expect(useChat.getState().agent).toBe('codex');
    vi.spyOn(api, 'sessionEvents').mockResolvedValue({
      session: { agent: 'codex', sessionId: 'history', summary: '历史', lastModified: 1 },
      events: [],
      actualModel: 'historical-model',
    });
    await useChat.getState().openSession({ agent: 'codex', sessionId: 'history' });
    expect(useChat.getState()).toMatchObject({
      actualModel: 'historical-model',
      modelOverrides: { claude: '', codex: '' },
    });
    useChat.getState().setModel('explicit-model');
    await useChat.getState().openSession({ agent: 'codex', sessionId: 'history' });
    expect(useChat.getState().modelOverrides.codex).toBe('explicit-model');
    useChat.getState().newSession();
    expect(useChat.getState()).toMatchObject({ agent: 'claude', modelOverrides: defaults.defaultModels });
    useChat.getState().touchDraft();
    useChat.setState({ initialDefaultsEligible: true, items: [], sessionId: undefined });
    useChat.getState().touchDraft();
    useChat.getState().setDefaults({ ...defaults, defaultModels: { claude: '', codex: '' } });
    expect(useChat.getState().modelOverrides.claude).toBe('example-claude');
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
    vi.spyOn(api, 'sessionEvents').mockResolvedValue(history('codex', '原生历史'));
    await useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    useChat.getState().setAgent('claude');
    expect(useChat.getState()).toMatchObject({
      agent: 'codex',
      actualModel: 'native-model',
      modelOverrides: { claude: 'claude-model', codex: 'codex-model' },
    });
    useChat.getState().send('续接');
    expect(sent.at(-1)).toMatchObject({
      agent: 'codex',
      sessionId: 'same-id',
      model: 'codex-model',
      reasoningEffort: 'high',
    });
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
      .spyOn(api, 'sessionEvents')
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
    vi.spyOn(api, 'sessionEvents').mockReturnValue(pending.promise);
    const loading = useChat.getState().openSession({ agent: 'codex', sessionId: 'same-id' });
    useChat.getState().selectWorkspace('w2');
    pending.resolve(history('codex', '旧工作区'));
    await loading;
    expect(useChat.getState()).toMatchObject({ workspaceId: 'w2', items: [], sessionId: undefined });
    const refresh = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    useChat.getState().send('新工作区');
    emit({ type: 'turn.finished', turnId: 'background', workspaceId: 'w1', agent: 'codex' });
    expect(refresh).toHaveBeenCalledWith({ queryKey: queryKeys.sessions('w1', 'codex') });
    expect(useChat.getState().running).toBe(true);
  });

  it('轮次尚未返回 ID 时保留停止意图，切换视图后仍中断原轮次', () => {
    useChat.getState().setAgent('codex');
    useChat.getState().send('开始');
    const request = sent[0] as Extract<ClientMessage, { type: 'chat.send' }>;
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
  });
});
