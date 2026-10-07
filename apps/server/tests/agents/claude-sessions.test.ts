import path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  renameSession,
} from '@anthropic-ai/claude-agent-sdk';
import { createClaudeSessions } from '../../src/agents/claude-sessions';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  deleteSession: vi.fn(),
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
    };
    const provider = createClaudeSessions(api);
    await provider.list(dir);
    expect(api.messages).not.toHaveBeenCalled();
    expect((await provider.read(id, dir)).actualModel).toBe('native-model');
    api.messages.mockResolvedValue([{ type: 'assistant', message: { model: '  ', content: [] } }]);
    expect((await provider.read(id, dir)).actualModel).toBeUndefined();
  });
});
