import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentKind, ServerMessage } from '@agentdeck/shared/conversation';
import type { SessionProvider } from '../../src/agents/contracts';
import { SessionError } from '../../src/agents/errors';
import { TurnManager } from '../../src/chat/turn-manager';
import { registerSessionRoutes } from '../../src/http/sessions.routes';
import { createSessionPreferences } from '../../src/sessions/preferences';
import { createSessionsService } from '../../src/sessions/service';
import { createWorkspaceActivity } from '../../src/workspaces/activity';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'session-permission-route-'));
  const project = { id: 'project', name: '示例', dir: path.join(root, 'project') };
  const other = { id: 'other', name: '其他项目', dir: path.join(root, 'other') };
  const preferences = createSessionPreferences({ configDir: root });
  const activity = createWorkspaceActivity();
  const provider: SessionProvider = {
    list: async () => [],
    assertBelongs: vi.fn(async (id) => {
      if (id !== 'native') throw new SessionError(404, 'session_missing', '没有此会话');
      return project.dir;
    }),
    read: vi.fn(async () => {
      throw new SessionError(501, 'session_not_replayable', '不可回放');
    }),
    mutate: vi.fn(),
    fork: vi.fn(),
  };
  const sessions = createSessionsService(
    { claude: provider, codex: provider, antigravity: provider },
    {
      preferences,
      projects: async () => [project, other],
      withIdleSession: (session, operation) => turns.withIdleSession(session, operation),
    },
  );
  const turns: TurnManager = new TurnManager({
    getWorkspace: async () => project,
    sessions,
    runners: {},
    acquireWorkspace: (id) => activity.acquire(id),
  });
  const app = Fastify();
  registerSessionRoutes(app, {
    sessions,
    activity,
    store: { get: async (id) => [project, other].find((entry) => entry.id === id) },
  });
  cleanup.push(async () => {
    await turns.dispose();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const url = (agent: AgentKind = 'claude', projectId = 'project') =>
    `/api/projects/${projectId}/sessions/${agent}/native/permission`;
  return { app, sessions, preferences, provider, turns, activity, project, url };
}

it('权限接口独立于原生历史，按 CLI 读取保存并支持重置为原生设置', async () => {
  const f = await fixture();
  const permission = { agent: 'antigravity', mode: 'plan' };
  const initial = await f.app.inject(f.url('antigravity'));
  expect(initial.statusCode).toBe(200);
  expect(initial.json()).toEqual({ permission: null });
  expect(initial.headers['cache-control']).toBe('no-store');
  const saved = await f.app.inject({ method: 'PUT', url: f.url('antigravity'), payload: { permission } });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toEqual({ permission });
  expect((await f.app.inject(f.url('antigravity'))).json()).toEqual({ permission });
  expect((await f.app.inject(f.url('claude'))).json()).toEqual({ permission: null });
  const reset = await f.app.inject({ method: 'PUT', url: f.url('antigravity'), payload: { permission: null } });
  expect(reset.statusCode).toBe(200);
  expect(reset.json()).toEqual({ permission: null });
  expect(await f.preferences.permission({ agent: 'antigravity', sessionId: 'native' })).toBeUndefined();
  expect(f.provider.read).not.toHaveBeenCalled();
  expect(f.provider.mutate).not.toHaveBeenCalled();
});

it('权限接口拒绝跨项目、未知身份、跨 CLI 和额外字段，不覆盖已保存记录', async () => {
  const f = await fixture();
  const permission = { agent: 'claude' as const, mode: 'acceptEdits' as const };
  await f.preferences.setPermission({ agent: 'claude', sessionId: 'native' }, permission);
  for (const method of ['GET', 'PUT'] as const) {
    const response = await f.app.inject({
      method,
      url: f.url('claude', 'other'),
      ...(method === 'PUT' ? { payload: { permission: null } } : {}),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect((await f.app.inject(f.url().replace('/native/', '/missing/'))).statusCode).toBe(404);
  for (const payload of [
    {},
    { permission: { agent: 'codex', mode: 'ask' } },
    { permission: { agent: 'claude', mode: 'unknown' } },
    { permission, defaultForNewSessions: true },
    { permission: { ...permission, allowAll: true } },
  ]) {
    const response = await f.app.inject({ method: 'PUT', url: f.url(), payload });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect((await f.app.inject(`${f.url()}?agent=codex`)).statusCode).toBe(400);
  expect(await f.preferences.permission({ agent: 'claude', sessionId: 'native' })).toEqual(permission);
});

it('已有会话占锁时拒绝权限修改，读取偏好仍可用', async () => {
  const f = await fixture();
  const finish = deferred();
  const running = f.turns.withIdleSession({ agent: 'claude', sessionId: 'native' }, () => finish.promise);
  try {
    const response = await f.app.inject({ method: 'PUT', url: f.url(), payload: { permission: null } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'session_busy' });
    expect((await f.app.inject(f.url())).statusCode).toBe(200);
  } finally {
    finish.resolve();
    await running;
  }
});

it('权限修改从归属核验起持有会话锁及项目租约，阻止启动和换目录并在完成后释放', async () => {
  const f = await fixture();
  const started = deferred();
  const finish = deferred();
  vi.mocked(f.provider.assertBelongs).mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
    return f.project.dir;
  });
  const saving = f.app
    .inject({ method: 'PUT', url: f.url(), payload: { permission: { agent: 'claude', mode: 'plan' } } })
    .then((response) => response);
  await started.promise;
  try {
    const sent: ServerMessage[] = [];
    await f.turns.handle(
      { send: (message) => sent.push(message), isOpen: () => true },
      {
        type: 'chat.send',
        agent: 'claude',
        workspaceId: 'project',
        sessionId: 'native',
        text: '继续',
        clientTurnId: 'c',
      },
    );
    expect(sent).toEqual([{ type: 'error', clientTurnId: 'c', message: '该会话正在运行' }]);
    await expect(f.activity.withIdle('project', async () => undefined)).rejects.toThrow('项目正在运行');
  } finally {
    finish.resolve();
  }
  expect((await saving).statusCode).toBe(200);
  expect(f.turns.isRunning({ agent: 'claude', sessionId: 'native' })).toBe(false);
  await expect(f.activity.withIdle('project', async () => undefined)).resolves.toBeUndefined();
});
