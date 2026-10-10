import path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSession,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  renameSession,
} from '@anthropic-ai/claude-agent-sdk';
import { createClaudeSessions } from '../../src/agents/claude-sessions';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  deleteSession: vi.fn(),
  forkSession: vi.fn(),
  getSessionInfo: vi.fn(),
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  renameSession: vi.fn(),
}));

const dir = path.join(tmpdir(), 'ssh-server-management', 'workspace');
const id = '11111111-1111-4111-8111-111111111111';
const metadata = { sessionId: id, summary: '原始标题', lastModified: 1, cwd: dir };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSessionInfo).mockResolvedValue(metadata);
  vi.mocked(renameSession).mockResolvedValue(undefined);
  vi.mocked(deleteSession).mockResolvedValue(undefined);
});

describe('Claude 原生会话管理', () => {
  it('重命名和删除均先校验 metadata，且 SDK 操作固定传入当前目录', async () => {
    const provider = createClaudeSessions();
    await provider.mutate(id, dir, { action: 'rename', title: '新标题' });
    await provider.mutate(id, dir, { action: 'delete', confirmed: true });
    expect(getSessionInfo).toHaveBeenCalledTimes(2);
    expect(getSessionInfo).toHaveBeenCalledWith(id, { dir });
    expect(renameSession).toHaveBeenCalledExactlyOnceWith(id, '新标题', { dir });
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(id, { dir });
    expect(vi.mocked(getSessionInfo).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(renameSession).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(getSessionInfo).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(deleteSession).mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    { label: '目录不一致', info: { ...metadata, cwd: path.join(dir, 'other') } },
    { label: '缺少目录', info: { ...metadata, cwd: undefined } },
    { label: 'ID 不一致', info: { ...metadata, sessionId: 'another-session' } },
  ])('$label 时禁止操作', async ({ info }) => {
    vi.mocked(getSessionInfo).mockResolvedValue(info);
    await expect(createClaudeSessions().mutate(id, dir, { action: 'delete', confirmed: true })).rejects.toMatchObject({
      status: 404,
      code: 'session_missing',
    });
    expect(deleteSession).not.toHaveBeenCalled();
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('不支持的归档、恢复及归档列表在 SDK 操作前拒绝', async () => {
    const provider = createClaudeSessions();
    await expect(provider.mutate(id, dir, { action: 'archive' })).rejects.toMatchObject({
      code: 'unsupported_action',
    });
    await expect(provider.mutate(id, dir, { action: 'unarchive' })).rejects.toMatchObject({
      code: 'unsupported_action',
    });
    await expect(provider.list(dir, undefined, true)).rejects.toMatchObject({ code: 'unsupported_action' });
    expect(getSessionInfo).not.toHaveBeenCalled();
    expect(listSessions).not.toHaveBeenCalled();
    expect(renameSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });
  it('缺cwd的历史仍可在指定目录只读，不放宽管理校验', async () => {
    vi.mocked(getSessionInfo).mockResolvedValue({ ...metadata, cwd: undefined });
    vi.mocked(getSessionMessages).mockResolvedValue([]);
    const provider = createClaudeSessions();
    expect(await provider.read(id, dir)).toMatchObject({ cwd: dir, session: { sessionId: id }, events: [] });
    await provider.assertBelongs(id, dir);
    await expect(provider.mutate(id, dir, { action: 'rename', title: '新标题' })).rejects.toMatchObject({
      status: 404,
    });
    expect(renameSession).not.toHaveBeenCalled();
  });
  it('历史只展示助手报告的非空模型，忽略用户字段和 synthetic 占位；列表不读全文', async () => {
    vi.mocked(listSessions).mockResolvedValue([metadata]);
    const api = {
      list: async () => [metadata],
      info: async () => metadata,
      messages: vi.fn().mockResolvedValue([
        { type: 'assistant', message: { role: 'assistant', model: 'native-model', content: [] } },
        { type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [] } },
        { type: 'user', message: { role: 'user', model: 'user-value', content: [] } },
        { type: 'assistant', parent_tool_use_id: 'child', message: { model: 'subagent-model', content: [] } },
      ]),
      rename: async () => undefined,
      delete: async () => undefined,
      fork: async () => ({ sessionId: 'forked-session' }),
    };
    const provider = createClaudeSessions(api);
    await provider.list(dir);
    expect(api.messages).not.toHaveBeenCalled();
    expect((await provider.read(id, dir)).actualModel).toBe('native-model');
    api.messages.mockResolvedValue([{ type: 'assistant', message: { model: '  ', content: [] } }]);
    expect((await provider.read(id, dir)).actualModel).toBeUndefined();
  });
});

const forkedId = '22222222-2222-4222-8222-222222222222';
const firstPoint = '33333333-3333-4333-8333-333333333333';
const lastPoint = '44444444-4444-4444-8444-444444444444';
const nativeMessage = (uuid = firstPoint, stopReason: string | null = 'end_turn') => ({
  type: 'assistant' as const,
  uuid,
  session_id: id,
  parent_tool_use_id: null,
  parent_agent_id: null,
  message: {
    id: 'api-message',
    role: 'assistant',
    model: 'native-model',
    content: [{ type: 'text', text: '回复' }],
    stop_reason: stopReason,
  },
});

describe('Claude SDK 原生会话分叉', () => {
  beforeEach(() => {
    vi.mocked(getSessionInfo).mockImplementation(async (sessionId) => ({
      ...metadata,
      sessionId,
      summary: sessionId === id ? '原始标题' : '原始标题 (fork)',
    }));
    vi.mocked(getSessionMessages).mockResolvedValue([nativeMessage(), nativeMessage(lastPoint)]);
    vi.mocked(forkSession).mockResolvedValue({ sessionId: forkedId });
  });

  it('指定点保持 inclusive 语义，原样传 transcript UUID 且返回原生新会话', async () => {
    const result = await createClaudeSessions().fork(id, dir, { pointId: firstPoint });
    expect(forkSession).toHaveBeenCalledExactlyOnceWith(id, { dir, upToMessageId: firstPoint });
    expect(getSessionMessages).toHaveBeenCalledExactlyOnceWith(id, { dir, includeSystemMessages: true });
    expect(result).toEqual({
      session: { sessionId: forkedId, summary: '原始标题 (fork)', lastModified: 1 },
      cwd: dir,
    });
    expect(getSessionInfo).toHaveBeenNthCalledWith(1, id, { dir });
    expect(getSessionInfo).toHaveBeenNthCalledWith(2, forkedId, { dir });
    expect(renameSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('省略 pointId 时由 SDK 完整分叉，不读取拼接文本或覆盖任何原生配置', async () => {
    await createClaudeSessions().fork(id, dir, {});
    expect(forkSession).toHaveBeenCalledExactlyOnceWith(id, { dir });
    expect(getSessionMessages).not.toHaveBeenCalled();
  });

  it.each([
    { label: '外来点', pointId: 'foreign-point', message: nativeMessage() },
    { label: '未结束', pointId: firstPoint, message: nativeMessage(firstPoint, null) },
    { label: '工具调用中', pointId: firstPoint, message: nativeMessage(firstPoint, 'tool_use') },
    { label: '另一会话', pointId: firstPoint, message: { ...nativeMessage(), session_id: 'foreign-session' } },
    { label: '子代理', pointId: firstPoint, message: { ...nativeMessage(), parent_tool_use_id: 'tool' } },
    { label: '嵌套子代理', pointId: firstPoint, message: { ...nativeMessage(), parent_agent_id: 'parent' } },
    { label: '用户输入', pointId: firstPoint, message: { ...nativeMessage(), type: 'user' as const } },
    { label: '模型消息ID', pointId: 'api-message', message: nativeMessage() },
  ])('$label 不交给 SDK 原生分叉', async ({ pointId, message }) => {
    vi.mocked(getSessionMessages).mockResolvedValueOnce([message]);
    await expect(createClaudeSessions().fork(id, dir, { pointId })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_fork_point',
    });
    expect(forkSession).not.toHaveBeenCalled();
  });

  it.each([
    { label: '跨目录', record: { ...metadata, cwd: path.join(dir, 'other') } },
    { label: '缺少目录', record: { ...metadata, cwd: undefined } },
    { label: '源ID错位', record: { ...metadata, sessionId: 'foreign-session' } },
    { label: '不存在或SDK过滤的sidechain', record: undefined },
  ])('源会话 $label 时拒绝，不能沿用只读的目录回退', async ({ record }) => {
    vi.mocked(getSessionInfo).mockResolvedValueOnce(record);
    await expect(createClaudeSessions().fork(id, dir, {})).rejects.toMatchObject({
      status: 404,
      code: 'session_missing',
    });
    expect(forkSession).not.toHaveBeenCalled();
    expect(getSessionMessages).not.toHaveBeenCalled();
  });

  it.each([id, '', '../session-file'])('原生新 ID 异常 %s，不读取不安全新路径且不撤销源记录', async (sessionId) => {
    vi.mocked(forkSession).mockResolvedValueOnce({ sessionId });
    await expect(createClaudeSessions().fork(id, dir, {})).rejects.toMatchObject({
      status: 503,
      code: 'session_runtime_failed',
    });
    expect(getSessionInfo).toHaveBeenCalledTimes(1);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...metadata, sessionId: forkedId, cwd: path.join(dir, 'other') },
    { ...metadata, sessionId: forkedId, cwd: undefined },
    { ...metadata, sessionId: 'foreign-session' },
  ])('新会话 metadata 缺失或身份/目录不符时报告安全错误 %j', async (record) => {
    vi.mocked(getSessionInfo).mockResolvedValueOnce(metadata).mockResolvedValueOnce(record);
    await expect(createClaudeSessions().fork(id, dir, {})).rejects.toMatchObject({
      status: 503,
      code: 'session_runtime_failed',
    });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('历史每个已结束原生位置输出 UUID，其他会话及未结束消息不产生分叉点', async () => {
    vi.mocked(getSessionMessages).mockResolvedValueOnce([
      nativeMessage(),
      nativeMessage(lastPoint),
      nativeMessage('in-progress', null),
      { ...nativeMessage('foreign-point'), session_id: 'foreign-session' },
    ]);
    const history = await createClaudeSessions().read(id, dir);
    expect(history.events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', isError: false, forkPoint: firstPoint },
      { type: 'turn_end', isError: false, forkPoint: lastPoint },
    ]);
  });
});
