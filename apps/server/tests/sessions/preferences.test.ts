import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createSessionPreferences } from '../../src/sessions/preferences';
import { createClaudeSessions, type ClaudeSessionsApi } from '../../src/agents/claude/sessions';
import { createSessionsService } from '../../src/sessions/service';
import { createAntigravitySessions } from '../../src/agents/antigravity/sessions';
import { pathToFileURL } from 'node:url';

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-preferences-'));
  roots.push(root);
  const preferences = createSessionPreferences({ configDir: root });
  return { root, preferences, file: path.join(root, 'session-preferences.json') };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('工作台归档只保存来源和会话身份，并发修改保留各项，恢复移除标记', async () => {
  const { preferences, file } = await fixture();
  await Promise.all([
    preferences.setArchived({ agent: 'claude', sessionId: 'first' }, true),
    preferences.setArchived({ agent: 'claude', sessionId: 'second' }, true),
  ]);
  expect(await preferences.archived('claude')).toEqual(new Set(['first', 'second']));
  expect(await preferences.archived('codex')).toEqual(new Set());
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
    version: 1,
    archived: [
      { agent: 'claude', sessionId: 'first' },
      { agent: 'claude', sessionId: 'second' },
    ],
    permissions: [],
  });
  await preferences.setArchived({ agent: 'claude', sessionId: 'first' }, false);
  expect(await preferences.archived('claude')).toEqual(new Set(['second']));
});

it('损坏的归档索引停止读写，不重置为空或覆盖原文', async () => {
  const { preferences, file } = await fixture();
  await fs.writeFile(file, 'invalid original');
  await expect(preferences.archived('claude')).rejects.toMatchObject({ code: 'session_preferences_unavailable' });
  await expect(preferences.setArchived({ agent: 'claude', sessionId: 'first' }, true)).rejects.toMatchObject({
    code: 'session_preferences_unavailable',
  });
  expect(await fs.readFile(file, 'utf8')).toBe('invalid original');
});

it('旧归档文件兼容权限偏好，归档修改保留权限且重启后按 CLI 独立恢复', async () => {
  const { preferences, file, root } = await fixture();
  const claude = { agent: 'claude' as const, sessionId: 'same-id' };
  const codex = { agent: 'codex' as const, sessionId: 'same-id' };
  await fs.writeFile(file, JSON.stringify({ version: 1, archived: [claude] }));
  expect(await preferences.permission(claude)).toBeUndefined();
  await Promise.all([
    preferences.setPermission(claude, { agent: 'claude', mode: 'acceptEdits' }),
    preferences.setPermission(codex, { agent: 'codex', mode: 'ask' }),
  ]);
  await preferences.setArchived(claude, false);
  await preferences.setArchived(codex, true);
  const restarted = createSessionPreferences({ configDir: root });
  expect(await restarted.permission(claude)).toEqual({ agent: 'claude', mode: 'acceptEdits' });
  expect(await restarted.permission(codex)).toEqual({ agent: 'codex', mode: 'ask' });
  expect(await restarted.archived('codex')).toEqual(new Set(['same-id']));
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
    version: 1,
    archived: [codex],
    permissions: [
      { ...claude, permission: { agent: 'claude', mode: 'acceptEdits' } },
      { ...codex, permission: { agent: 'codex', mode: 'ask' } },
    ],
  });
});

it('重置仅移除目标权限，删除同时清理目标归档与权限且不波及同 ID 的其他 CLI', async () => {
  const { preferences } = await fixture();
  const claude = { agent: 'claude' as const, sessionId: 'same-id' };
  const codex = { agent: 'codex' as const, sessionId: 'same-id' };
  await preferences.setArchived(claude, true);
  await preferences.setPermission(claude, { agent: 'claude', mode: 'plan' });
  await preferences.setPermission(codex, { agent: 'codex', mode: 'full-access' });
  await preferences.setPermission(claude, null);
  expect(await preferences.permission(claude)).toBeUndefined();
  expect(await preferences.archived('claude')).toEqual(new Set(['same-id']));
  await preferences.setPermission(claude, { agent: 'claude', mode: 'default' });
  await preferences.remove(claude);
  expect(await preferences.permission(claude)).toBeUndefined();
  expect(await preferences.archived('claude')).toEqual(new Set());
  expect(await preferences.permission(codex)).toEqual({ agent: 'codex', mode: 'full-access' });
});

it('权限写入拒绝跨 CLI 和损坏内容，失败保留原文件', async () => {
  const { preferences, file } = await fixture();
  const session = { agent: 'claude' as const, sessionId: 'native' };
  await preferences.setPermission(session, { agent: 'claude', mode: 'plan' });
  const before = await fs.readFile(file, 'utf8');
  await expect(preferences.setPermission(session, { agent: 'codex', mode: 'ask' })).rejects.toMatchObject({
    code: 'session_preferences_unavailable',
  });
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  await fs.writeFile(file, 'invalid original');
  await expect(preferences.permission(session)).rejects.toMatchObject({ code: 'session_preferences_unavailable' });
  await expect(preferences.setPermission(session, null)).rejects.toMatchObject({
    code: 'session_preferences_unavailable',
  });
  expect(await fs.readFile(file, 'utf8')).toBe('invalid original');
});

it('Claude 工作台归档统一投影所有列表，原生删除后清理标记，不修改历史正文', async () => {
  const { preferences, root } = await fixture();
  const project = { id: 'project', name: '示例', dir: path.join(root, 'project') };
  const records = [
    { sessionId: 'first', summary: '摘要', lastModified: 1, cwd: project.dir },
    { sessionId: 'outside', summary: '其他目录', lastModified: 2, cwd: path.join(root, 'outside') },
  ];
  const mutations: string[] = [];
  const native: ClaudeSessionsApi = {
    list: async () => records,
    info: async (id) => records.find((entry) => entry.sessionId === id),
    messages: async () => {
      throw new Error('归档不能读取正文');
    },
    rename: async () => {
      mutations.push('rename');
    },
    delete: async () => {
      mutations.push('delete');
    },
    fork: async () => {
      throw new Error('归档不能创建分支');
    },
  };
  const service = createSessionsService(
    { claude: createClaudeSessions(native) },
    {
      preferences,
      projects: async () => [project],
      withIdleSession: (_session, operation) => operation(),
    },
  );
  await service.mutate(project, 'claude', 'first', { action: 'archive' });
  expect(mutations).toEqual([]);
  await expect(service.assertBelongs(project, 'claude', 'first')).rejects.toMatchObject({ code: 'session_archived' });
  await expect(service.fork(project, 'claude', 'first', {})).rejects.toMatchObject({ code: 'session_archived' });
  expect((await service.list(project, 'claude')).map((entry) => entry.sessionId)).toEqual(['outside']);
  expect((await service.archived('claude'))[0]).toMatchObject({
    sessionId: 'first',
    projectId: 'project',
    capabilities: { archive: 'workbench', fork: 'native', delete: 'native' },
  });
  await preferences.setArchived({ agent: 'claude', sessionId: 'outside' }, true);
  expect(await service.unassigned('claude')).toEqual([]);
  await service.mutate(project, 'claude', 'first', { action: 'unarchive' });
  expect((await service.list(project, 'claude')).map((entry) => entry.sessionId)).toEqual(['first']);
  await service.mutate(project, 'claude', 'first', { action: 'archive' });
  await preferences.setPermission({ agent: 'claude', sessionId: 'first' }, { agent: 'claude', mode: 'plan' });
  await service.mutate(project, 'claude', 'first', { action: 'delete', confirmed: true });
  expect(mutations).toEqual(['delete']);
  expect(await preferences.archived('claude')).toEqual(new Set(['outside']));
  expect(await preferences.permission({ agent: 'claude', sessionId: 'first' })).toBeUndefined();
});

it('原生删除成功后的标记清理失败不回报删除失败，运行与归属锁仍保护归档', async () => {
  const { root, preferences } = await fixture();
  const project = { id: 'project', name: '示例', dir: path.join(root, 'project') };
  const native = createClaudeSessions({
    list: async () => [],
    info: async (id) => ({ sessionId: id, summary: '', lastModified: 1, cwd: project.dir }),
    messages: async () => [],
    rename: async () => undefined,
    delete: async () => undefined,
    fork: async () => ({ sessionId: 'new' }),
  });
  const removed: string[] = [];
  let busy = false;
  const service = createSessionsService(
    { claude: native },
    {
      preferences: {
        ...preferences,
        remove: async () => {
          removed.push('cleanup');
          throw new Error('模拟存储失败');
        },
      },
      projects: async () => [project],
      withIdleSession: (_session, operation) => {
        if (busy) return Promise.reject(new Error('运行中'));
        return operation();
      },
    },
  );
  await expect(
    service.mutate(project, 'claude', 'first', { action: 'delete', confirmed: true }),
  ).resolves.toBeUndefined();
  expect(removed).toEqual(['cleanup']);
  busy = true;
  await expect(service.mutate(project, 'claude', 'first', { action: 'archive' })).rejects.toBeDefined();
  expect(await preferences.archived('claude')).toEqual(new Set());
});

it('Antigravity 使用同一本地归档机制，恢复不调用原生修改接口', async () => {
  const { preferences, root } = await fixture();
  const project = { id: 'project', name: '示例', dir: path.join(root, 'project') };
  const provider = createAntigravitySessions({
    readSummaries: () => [
      {
        conversationId: 'agy-session',
        title: '会话',
        lastModified: '2026-01-01 00:00:00',
        preview: '',
        workspaceUris: pathToFileURL(project.dir).href,
      },
    ],
  });
  const service = createSessionsService(
    { antigravity: provider },
    { preferences, projects: async () => [project], withIdleSession: (_session, operation) => operation() },
  );
  await service.mutate(project, 'antigravity', 'agy-session', { action: 'archive' });
  expect(await service.list(project, 'antigravity')).toEqual([]);
  expect((await service.archived('antigravity'))[0]).toMatchObject({
    sessionId: 'agy-session',
    capabilities: { archive: 'workbench' },
  });
  await service.mutate(project, 'antigravity', 'agy-session', { action: 'unarchive' });
  expect((await service.list(project, 'antigravity'))[0]?.sessionId).toBe('agy-session');
  expect(await service.archived('antigravity')).toEqual([]);
});
