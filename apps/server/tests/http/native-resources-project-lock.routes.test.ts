import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { registerNativeResourceRoutes } from '../../src/http/native-resources.routes';
import { registerProjectRoutes } from '../../src/http/projects.routes';
import { createNativeResourcesService } from '../../src/settings/native-resources';
import { createWorkspaceActivity } from '../../src/workspaces/activity';
import { createWorkspaceStore } from '../../src/workspaces/store';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const tempRoot = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(tempRoot, 'native-resource-project-lock-'));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  await Promise.all([mkdir(first), mkdir(second)]);
  const activity = createWorkspaceActivity();
  const store = createWorkspaceStore({
    configDir: path.join(root, 'config'),
    dirExists: async () => true,
    knownHosts: async () => [],
  });
  const project = await store.create({ name: '示例', dir: first });
  const started = deferred();
  const finish = deferred();
  const native = createNativeResourcesService({ homeDir: root, env: {} });
  const service = {
    ...native,
    async save(...args: Parameters<typeof native.save>) {
      started.resolve();
      await finish.promise;
      return native.save(...args);
    },
    async create(...args: Parameters<typeof native.create>) {
      started.resolve();
      await finish.promise;
      return native.create(...args);
    },
  };
  const app = Fastify();
  registerProjectRoutes(app, { store, activity });
  registerNativeResourceRoutes(app, { store, service, activity });
  const catalog = await native.list('claude', project);
  const target = catalog.entries.find((entry) => entry.kind === 'settings' && entry.scope === 'project')!;
  const rules = catalog.roots.find((entry) => entry.kind === 'rules' && entry.scope === 'project')!;
  return {
    app,
    store,
    activity,
    project,
    first,
    second,
    started,
    finish,
    request(operation: 'save' | 'create') {
      return operation === 'save'
        ? {
            method: 'PUT' as const,
            url: `/api/native-resources/claude/${target.id}?projectId=${project.id}`,
            payload: { content: '{}', revision: 'missing' },
          }
        : {
            method: 'POST' as const,
            url: `/api/native-resources/claude?projectId=${project.id}`,
            payload: { rootId: rules.id, name: 'demo', content: '# 规则' },
          };
    },
    async close() {
      finish.resolve();
      await app.close();
      if (path.dirname(root) !== tempRoot || !path.basename(root).startsWith('native-resource-project-lock-'))
        throw new Error('临时目录越界');
      await rm(root, { recursive: true, force: true });
    },
  };
}

it.each(['save', 'create'] as const)('原生资源 %s 在途时阻止项目换目录和删除，写入完成后释放', async (operation) => {
  const f = await fixture();
  try {
    const pending = f.app.inject(f.request(operation)).then((response) => response);
    await f.started.promise;
    expect(
      (await f.app.inject({ method: 'PATCH', url: `/api/projects/${f.project.id}`, payload: { dir: f.second } }))
        .statusCode,
    ).toBe(409);
    expect((await f.app.inject({ method: 'DELETE', url: `/api/projects/${f.project.id}` })).statusCode).toBe(409);
    f.finish.resolve();
    expect((await pending).statusCode).toBe(operation === 'save' ? 200 : 201);
    const file =
      operation === 'save'
        ? path.join(f.first, '.claude', 'settings.json')
        : path.join(f.first, '.claude', 'rules', 'demo.md');
    expect(await readFile(file, 'utf8')).toBe(operation === 'save' ? '{}' : '# 规则');
    expect(
      (await f.app.inject({ method: 'PATCH', url: `/api/projects/${f.project.id}`, payload: { dir: f.second } }))
        .statusCode,
    ).toBe(200);
  } finally {
    await f.close();
  }
});

it('项目管理先持有租约时不读取旧项目快照，也不启动原生写入', async () => {
  const f = await fixture();
  const release = deferred();
  const managing = f.activity.withIdle(f.project.id, () => release.promise);
  const get = vi.spyOn(f.store, 'get');
  f.finish.resolve();
  try {
    const response = await f.app.inject(f.request('save'));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'project_busy' });
    expect(get).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await managing;
    await f.close();
  }
});
