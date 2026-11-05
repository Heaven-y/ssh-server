import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeSessions, type ClaudeSessionsApi } from '../../src/agents/claude-sessions';
import { createSessionsService } from '../../src/chat/sessions';
import { createAntigravitySessions } from '../../src/agents/antigravity/sessions';

const parent = { id: 'parent', name: '父项目', dir: path.join(tmpdir(), 'discovery-fixture', 'parent') };
const child = { id: 'child', name: '子项目', dir: path.join(parent.dir, 'child') };
const outside = path.join(tmpdir(), 'discovery-fixture', 'other');
function fixture(projects = [parent, child]) {
  const records = [
    { sessionId: 'nested', summary: '子目录会话', cwd: child.dir, lastModified: 10 },
    { sessionId: 'orphan', summary: '未登记会话', cwd: outside, lastModified: 20 },
  ];
  const api: ClaudeSessionsApi = {
    list: vi.fn(async () => records),
    info: vi.fn(async (id) => records.find((record) => record.sessionId === id)),
    messages: vi.fn(async () => []),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ sessionId: 'forked' })),
  };
  const sessions = createSessionsService(
    { claude: createClaudeSessions(api) },
    {
      projects: async () => projects,
      withIdleSession: (_session, operation) => operation(),
    },
  );
  return { api, sessions };
}

describe('原生会话发现与实际目录', () => {
  it('父项目能发现子目录与未登记会话，多个项目共用有界的原生元数据读取', async () => {
    const { api, sessions } = fixture();
    const [first, second] = await Promise.all([sessions.list(parent, 'claude'), sessions.list(child, 'claude')]);
    expect(first.map((row) => [row.sessionId, row.projectId, row.directory])).toEqual([
      ['nested', 'parent', child.dir],
      ['orphan', null, outside],
    ]);
    expect(second).toEqual(first);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('父项目读取和管理使用原生子目录，后登记子项目不能越过唯一归属', async () => {
    const { api, sessions } = fixture();
    expect(await sessions.assertBelongs(parent, 'claude', 'nested')).toMatchObject({ id: parent.id, dir: child.dir });
    expect((await sessions.read(parent, 'claude', 'nested')).session.sessionId).toBe('nested');
    await sessions.mutate(parent, 'claude', 'nested', { action: 'rename', title: '新名称' });
    expect(api.messages).toHaveBeenCalledWith('nested', child.dir);
    expect(api.rename).toHaveBeenCalledWith('nested', '新名称', child.dir);
    await expect(sessions.read(child, 'claude', 'nested')).rejects.toMatchObject({ status: 404 });
    await expect(
      sessions.mutate(child, 'claude', 'nested', { action: 'delete', confirmed: true }),
    ).rejects.toMatchObject({ status: 404 });
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('Antigravity 多工作区会话按完整 URI 唯一归属，不能从另一项目续接', async () => {
    const other = { id: 'other', name: '另一个项目', dir: outside };
    const provider = createAntigravitySessions({
      readSummaries: () => [
        {
          conversationId: 'multi',
          title: '多目录',
          preview: '',
          lastModified: '2026-01-01 00:00:00',
          workspaceUris: JSON.stringify([pathToFileURL(child.dir).href, pathToFileURL(other.dir).href]),
        },
      ],
    });
    const sessions = createSessionsService(
      { antigravity: provider },
      {
        projects: async () => [parent, other],
        withIdleSession: (_session, operation) => operation(),
      },
    );
    expect((await sessions.list(parent, 'antigravity'))[0]?.projectId).toBe(parent.id);
    expect(await sessions.assertBelongs(parent, 'antigravity', 'multi')).toMatchObject({ id: parent.id });
    await expect(sessions.assertBelongs(other, 'antigravity', 'multi')).rejects.toMatchObject({ status: 404 });
  });
});
