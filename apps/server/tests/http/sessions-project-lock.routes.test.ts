import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerProjectRoutes } from '../../src/http/projects.routes';
import { registerSessionRoutes } from '../../src/http/sessions.routes';
import { createWorkspaceActivity } from '../../src/workspaces/activity';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createSessionsService, type SessionProvider } from '../../src/chat/sessions';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const tempRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'agentdeck-session-lock-'));
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  await Promise.all([mkdir(first), mkdir(second)]);
  const activity = createWorkspaceActivity();
  const store = createWorkspaceStore({
    configDir: path.join(directory, 'config'),
    dirExists: async () => true,
    knownHosts: async () => [],
  });
  const project = await store.create({ name: 'fixture', dir: first });
  const started = deferred();
  const finish = deferred();
  const mutate = vi.fn(async () => {
    started.resolve();
    await finish.promise;
  });
  const fork = vi.fn(async () => {
    started.resolve();
    await finish.promise;
    return { cwd: first, session: { sessionId: 'forked', summary: '', lastModified: 1 } };
  });
  const provider = { mutate, fork, assertBelongs: async () => first } as unknown as SessionProvider;
  const sessions = createSessionsService(
    { claude: provider },
    { withIdleSession: (_session, operation) => operation() },
  );
  const app = Fastify();
  registerProjectRoutes(app, { store, activity });
  registerSessionRoutes(app, { store, sessions, activity });
  return {
    app,
    store,
    activity,
    project,
    first,
    second,
    started,
    finish,
    mutate,
    fork,
    async close() {
      finish.resolve();
      await app.close();
      if (path.dirname(directory) !== tempRoot || !path.basename(directory).startsWith('agentdeck-session-lock-'))
        throw new Error('临时路径范围不合法');
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const cases = [
  { endpoint: 'actions', payload: { action: 'delete', confirmed: true }, status: 204 },
  { endpoint: 'fork', payload: {}, status: 200 },
];

it.each(cases)('$endpoint 原生写入在途阻止项目换目录和删除，完成后释放租约', async ({ endpoint, payload, status }) => {
  const f = await fixture();
  try {
    const pending = f.app
      .inject({ method: 'POST', url: `/api/projects/${f.project.id}/sessions/claude/native/${endpoint}`, payload })
      .then((result) => result);
    await f.started.promise;
    const changed = await f.app.inject({
      method: 'PATCH',
      url: `/api/projects/${f.project.id}`,
      payload: { dir: f.second },
    });
    const removed = await f.app.inject({ method: 'DELETE', url: `/api/projects/${f.project.id}` });
    expect(changed.statusCode).toBe(409);
    expect(removed.statusCode).toBe(409);
    expect((await f.store.get(f.project.id))?.dir).toBe(f.first);
    f.finish.resolve();
    expect((await pending).statusCode).toBe(status);
    expect(
      (await f.app.inject({ method: 'PATCH', url: `/api/projects/${f.project.id}`, payload: { dir: f.second } }))
        .statusCode,
    ).toBe(200);
  } finally {
    await f.close();
  }
});

it('项目管理先取得锁时会话写动作在读取旧项目之前拒绝', async () => {
  const f = await fixture();
  f.finish.resolve();
  const released = deferred();
  const managing = f.activity.withIdle(f.project.id, () => released.promise);
  const get = vi.spyOn(f.store, 'get');
  try {
    for (const { endpoint, payload } of cases) {
      const response = await f.app.inject({
        method: 'POST',
        url: `/api/projects/${f.project.id}/sessions/claude/native/${endpoint}`,
        payload,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'project_busy' });
    }
    expect(get).not.toHaveBeenCalled();
    expect(f.mutate).not.toHaveBeenCalled();
    expect(f.fork).not.toHaveBeenCalled();
  } finally {
    released.resolve();
    await managing;
    await f.close();
  }
});
