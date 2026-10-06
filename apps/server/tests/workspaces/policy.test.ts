import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import type { WorkspacePolicyDocument } from '@ssh-server/shared';
import { createWorkspaceStore } from '../../src/workspaces/store';
import { createWorkspacePolicy } from '../../src/workspaces/policy';
import { registerWorkspacePolicyRoutes } from '../../src/http/workspace-policy.routes';
import { registerWorkspaceRoutes } from '../../src/http/workspaces.routes';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workspace-policy-'));
  dirs.push(dir);
  const store = createWorkspaceStore({
    configDir: dir,
    dirExists: async () => true,
    knownHosts: async () => ['my-server'],
  });
  const workspace = await store.create({
    name: 'demo',
    localDir: path.join(dir, 'local'),
    sshHost: 'my-server',
    remoteDir: '~/projects/demo',
  });
  return { dir, store, workspace, service: createWorkspacePolicy(store) };
}
it('缺省读取、重启持久化，同摘要并发只接受一次且保留其他工作区字段', async () => {
  const f = await fixture();
  const initial = await f.service.read(f.workspace.id);
  expect(initial.policy).toEqual({});
  const requests = await Promise.allSettled([
    f.service.save(f.workspace.id, { revision: initial.revision, policy: { disabledRules: ['privilege'] } }),
    f.service.save(f.workspace.id, { revision: initial.revision, policy: { disabledRules: ['power'] } }),
  ]);
  expect(requests.map((request) => request.status)).toEqual(['fulfilled', 'rejected']);
  expect(requests[1]).toMatchObject({ reason: { status: 409, code: 'policy_changed' } });
  const restarted = createWorkspacePolicy(
    createWorkspaceStore({ configDir: f.dir, dirExists: async () => true, knownHosts: async () => ['my-server'] }),
  );
  expect((await restarted.read(f.workspace.id)).policy).toEqual({ disabledRules: ['privilege'] });
  const current = await f.service.read(f.workspace.id);
  await f.store.update(f.workspace.id, { name: '新名称', sync: { maxFileBytes: 1234, excludedExtensions: [] } });
  await expect(f.service.save(f.workspace.id, { revision: current.revision, policy: {} })).rejects.toMatchObject({
    status: 409,
  });
  const fresh = await f.service.read(f.workspace.id);
  await f.service.save(f.workspace.id, { revision: fresh.revision, policy: {} });
  expect(await f.store.get(f.workspace.id)).toMatchObject({
    name: '新名称',
    sync: { maxFileBytes: 1234 },
    localDir: f.workspace.localDir,
  });
});
it('实际HTTP拒绝非法/陈旧输入与通用PATCH绕过，坏规则保留，错误不透出私有诊断', async () => {
  const f = await fixture();
  const app = Fastify();
  registerWorkspacePolicyRoutes(app, f.service);
  registerWorkspaceRoutes(app, { store: f.store, listSshHosts: async () => [] });
  const url = `/api/workspaces/${f.workspace.id}/policy`;
  try {
    const read = await app.inject({ method: 'GET', url });
    expect(read.headers['cache-control']).toBe('no-store');
    const initial = read.json<WorkspacePolicyDocument>();
    const saved = await app.inject({
      method: 'PUT',
      url,
      payload: {
        ...initial,
        policy: { customRules: [{ id: 'custom-marker', kind: 'contains', pattern: 'marker', reason: '测试标记' }] },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url, payload: initial })).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          payload: { ...saved.json<WorkspacePolicyDocument>(), policy: { disabledRules: ['unknown'] } },
        })
      ).statusCode,
    ).toBe(400);
    const beforePatch = await readFile(path.join(f.dir, 'workspaces.json'), 'utf8');
    expect(
      (await app.inject({ method: 'PATCH', url: `/api/workspaces/${f.workspace.id}`, payload: { policy: {} } }))
        .statusCode,
    ).toBe(404);
    expect(await readFile(path.join(f.dir, 'workspaces.json'), 'utf8')).toBe(beforePatch);
    expect((await app.inject({ method: 'GET', url: '/api/workspaces/missing/policy' })).statusCode).toBe(404);
    await expect(f.service.save('missing', { revision: initial.revision, policy: {} })).rejects.toMatchObject({
      status: 404,
    });
    const file = path.join(f.dir, 'workspaces.json');
    const corrupt = JSON.stringify([{ ...f.workspace, policy: { customRules: 'bad' } }]);
    await writeFile(file, corrupt);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(503);
    expect(await readFile(file, 'utf8')).toBe(corrupt);
    const nullPolicy = JSON.stringify([{ ...f.workspace, policy: null }]);
    await writeFile(file, nullPolicy);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(503);
    expect(await readFile(file, 'utf8')).toBe(nullPolicy);
  } finally {
    await app.close();
  }
  const failed = Fastify();
  registerWorkspacePolicyRoutes(failed, {
    read: async () => {
      throw new Error('private-diagnostic');
    },
    save: async () => {
      throw new Error('private-diagnostic');
    },
  });
  try {
    const response = await failed.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private-diagnostic');
  } finally {
    await failed.close();
  }
});
