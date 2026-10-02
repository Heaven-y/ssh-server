import path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteSession, getSessionInfo, listSessions, renameSession } from '@anthropic-ai/claude-agent-sdk';
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
    await provider.mutate!(id, dir, { action: 'rename', title: '新标题' });
    await provider.mutate!(id, dir, { action: 'delete', confirmed: true });
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
    await expect(createClaudeSessions().mutate!(id, dir, { action: 'delete', confirmed: true })).rejects.toMatchObject({
      status: 404,
      code: 'session_missing',
    });
    expect(deleteSession).not.toHaveBeenCalled();
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('不支持的归档、恢复及归档列表在 SDK 操作前拒绝', async () => {
    const provider = createClaudeSessions();
    await expect(provider.mutate!(id, dir, { action: 'archive' })).rejects.toMatchObject({
      code: 'unsupported_action',
    });
    await expect(provider.mutate!(id, dir, { action: 'unarchive' })).rejects.toMatchObject({
      code: 'unsupported_action',
    });
    await expect(provider.list(dir, undefined, true)).rejects.toMatchObject({ code: 'unsupported_action' });
    expect(getSessionInfo).not.toHaveBeenCalled();
    expect(listSessions).not.toHaveBeenCalled();
    expect(renameSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
