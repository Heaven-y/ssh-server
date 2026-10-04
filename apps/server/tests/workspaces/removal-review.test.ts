import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../../src/http/app';
import { registerSessionRoutes } from '../../src/http/sessions.routes';
import { createSessionsService } from '../../src/chat/sessions';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createWorkspaceActivity } from '../../src/workspaces/activity';
import { createWorkspaceRemoval } from '../../src/workspaces/removal';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('活动Hook不改变静态页面及资产的回调式发送行为', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-static-review-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const webDir = path.join(root, 'web');
  await mkdir(webDir);
  const html = '<!doctype html><html lang="zh-CN"><body>工作区页面</body></html>';
  await writeFile(path.join(webDir, 'index.html'), html);
  await writeFile(path.join(webDir, 'app.js'), 'console.log("工作区");');
  const store = createWorkspaceStore({
    configDir: path.join(root, 'config'),
    knownHosts: async () => [],
    dirExists: async () => true,
  });
  const app = await buildApp({
    token: 'fixture-token',
    port: 0,
    store,
    webDir,
    activity: createWorkspaceActivity(),
    listSshHosts: async () => [],
  });
  cleanups.unshift(() => app.close());
  expect((await app.inject('/')).body).toBe(html);
  expect((await app.inject('/app.js')).body).toBe('console.log("工作区");');
});

it('普通HTTP伪造Upgrade头仍保护实际原生会话写入，收尾后才允许移除', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-removal-review-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const localDir = path.join(root, 'project');
  await mkdir(localDir);
  const store = createWorkspaceStore({
    configDir: path.join(root, 'config'),
    knownHosts: async () => ['my-server'],
    dirExists: async () => true,
  });
  const workspace = await store.create({ name: '演示', localDir, sshHost: 'my-server', remoteDir: '~/projects/demo' });
  const activity = createWorkspaceActivity();
  const removal = createWorkspaceRemoval({ store, activity, blockers: async () => [], close: () => undefined });
  const preview = await removal.preview(workspace.id);
  const entered = gate();
  const finish = gate();
  let written = false;
  const provider = {
    list: async () => [],
    read: async () => {
      throw new Error('本用例不读取原生记录');
    },
    assertBelongs: async () => undefined,
    mutate: async () => {
      entered.resolve();
      await finish.promise;
      written = true;
    },
  };
  const sessions = createSessionsService(
    { claude: provider, codex: provider },
    { withIdleSession: (_session, operation) => operation() },
  );
  const app = await buildApp({
    token: 'fixture-token',
    port: 0,
    store,
    activity,
    removal,
    listSshHosts: async () => [],
    routes: (server) => registerSessionRoutes(server, { store, sessions }),
  });
  cleanups.unshift(() => app.close());
  const headers = { host: '127.0.0.1:0', origin: 'http://127.0.0.1:0', cookie: 'ssh_server_session=fixture-token' };
  const write = app
    .inject({
      method: 'POST',
      url: `/api/workspaces/${workspace.id}/sessions/native-id/actions?agent=codex`,
      headers: { ...headers, upgrade: 'websocket' },
      payload: { action: 'rename', title: '更名' },
    })
    .then((reply) => reply);
  await Promise.race([
    entered.promise,
    write.then((reply) => {
      throw new Error(`原生写入未开始：HTTP ${reply.statusCode}`);
    }),
  ]);
  try {
    const reply = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}`,
      headers,
      payload: { configuration: preview.configuration, confirmed: true },
    });
    expect(reply.statusCode).toBe(409);
    expect(written).toBe(false);
    expect(await store.get(workspace.id)).toBeDefined();
  } finally {
    finish.resolve();
    expect((await write).statusCode).toBe(204);
  }
  expect(activity.active(workspace.id)).toBe(0);
  expect(await removal.remove(workspace.id, { configuration: preview.configuration, confirmed: true })).toEqual({
    removed: true,
  });
});
