import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProbes } from '../../src/agents/probe';
import { registerProjectRoutes } from '../../src/http/projects.routes';
import { registerProbeRoutes } from '../../src/http/probe.routes';
import { createWorkspaceStore } from '../../src/workspaces/store';

const apps: FastifyInstance[] = [];
const tempRoots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

/** 用真实 store：PATCH 的「null 清除、缺省不动」语义必须穿过 store 的合并与校验，才证明路由没写错。 */
async function setup() {
  const configDir = await tempDir('agentdeck-projects-config-');
  const store = createWorkspaceStore({
    configDir,
    dirExists: (p) =>
      stat(p).then(
        (entry) => entry.isDirectory(),
        () => false,
      ),
    knownHosts: async () => ['my-server'],
  });
  const app = Fastify();
  apps.push(app);
  registerProjectRoutes(app, { store });
  return { app, store, configDir };
}

const create = (app: FastifyInstance, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/projects', payload });

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('项目接口', () => {
  it('列出项目：空配置返回空数组且禁止缓存', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/projects');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('创建项目后能查到', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    const created = await create(app, { name: '示例项目', dir });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const list = await app.inject('/api/projects');
    expect(list.json().some((project: { id: string }) => project.id === id)).toBe(true);
  });

  it('目录不是绝对路径或不存在时返回 400 与字段信息', async () => {
    const { app } = await setup();
    const relative = await create(app, { name: '相对目录', dir: 'relative/dir' });
    expect(relative.statusCode).toBe(400);
    expect(relative.json()).toMatchObject({ code: 'invalid_project', field: 'dir', message: '项目目录必须是绝对路径' });

    const missing = await create(app, { name: '不存在', dir: path.join(os.tmpdir(), 'agentdeck-no-such-dir') });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: 'invalid_project', field: 'dir', message: '项目目录不存在' });

    const unknownHost = await create(app, {
      name: '未登记服务器',
      dir: await tempDir('agentdeck-project-'),
      server: 'unknown-host',
      remoteDir: '~/x',
    });
    expect(unknownHost.statusCode).toBe(400);
    expect(unknownHost.json()).toMatchObject({
      code: 'invalid_project',
      field: 'server',
      message: '服务器未登记，请先保存服务器档案',
    });
  });

  it('只改名字时保留服务器绑定与目录', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    const created = await create(app, { name: '旧名字', dir, server: 'my-server', remoteDir: '~/projects/demo' });
    const id = created.json().id;

    const patched = await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: { name: '新名字' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id,
      name: '新名字',
      dir,
      server: 'my-server',
      remoteDir: '~/projects/demo',
    });
    // 从落盘结果再读一次，确认不是只在响应里拼出来的。
    const listed = await app.inject('/api/projects');
    expect(listed.json()).toEqual([{ id, name: '新名字', dir, server: 'my-server', remoteDir: '~/projects/demo' }]);
  });

  it('同时传 null 解绑两半，退回纯本地项目', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    const created = await create(app, { name: '已绑定', dir, server: 'my-server', remoteDir: '~/projects/demo' });
    const id = created.json().id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { server: null, remoteDir: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({ id, name: '已绑定', dir });
    const listed = await app.inject('/api/projects');
    expect(listed.json()).toEqual([{ id, name: '已绑定', dir }]);
  });

  it('只解绑一半返回 400，且原绑定不变', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    const created = await create(app, { name: '已绑定', dir, server: 'my-server', remoteDir: '~/projects/demo' });
    const id = created.json().id;

    for (const payload of [{ server: null }, { remoteDir: null }]) {
      const response = await app.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_project', field: 'remoteDir' });
    }
    const listed = await app.inject('/api/projects');
    expect(listed.json()).toEqual([{ id, name: '已绑定', dir, server: 'my-server', remoteDir: '~/projects/demo' }]);
  });

  it('解绑后可以重新绑定，绑定必须成对给出', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    const created = await create(app, { name: '项目', dir });
    const id = created.json().id;

    const half = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { server: 'my-server' },
    });
    expect(half.statusCode).toBe(400);
    expect(half.json()).toMatchObject({ field: 'remoteDir' });

    const bound = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { server: 'my-server', remoteDir: '~/x' },
    });
    expect(bound.statusCode).toBe(200);
    expect(bound.json()).toMatchObject({ server: 'my-server', remoteDir: '~/x' });
  });

  it('修改不存在的项目返回 404', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'PATCH', url: '/api/projects/missing', payload: { name: 'x' } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'workspace_missing', message: '项目不存在' });
  });

  it('删除项目只移除配置，重复删除返回 404', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    const created = await create(app, { name: '待删除', dir });
    const id = created.json().id;

    const removed = await app.inject({ method: 'DELETE', url: `/api/projects/${id}` });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    expect((await app.inject('/api/projects')).json()).toEqual([]);
    // 项目目录本身还在，删除的只是本工具的配置。
    expect((await stat(dir)).isDirectory()).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${id}` })).statusCode).toBe(404);
  });

  it('配置文件损坏时返回 503 而不是空列表', async () => {
    const { app, configDir } = await setup();
    await writeFile(path.join(configDir, 'workspaces.json'), '{not json', 'utf8');
    const response = await app.inject('/api/projects');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'project_storage_failed' });
    expect(response.json().message).toContain('配置损坏');
  });

  it('旧的 /api/workspaces 列表别名已删除，避免两套入口并存', async () => {
    const { app } = await setup();
    const dir = await tempDir('agentdeck-project-');
    await create(app, { name: '示例项目', dir });
    // 项目列表只有 /api/projects 一个入口；旧别名删掉后必须是真的 404。
    const legacy = await app.inject('/api/workspaces');
    expect(legacy.statusCode).toBe(404);
    const current = await app.inject('/api/projects');
    expect(current.statusCode).toBe(200);
  });
});

describe('Agent 探测接口', () => {
  async function probeApp() {
    const probeAll = vi.fn<AgentProbes['probeAll']>(async () => [
      { agent: 'claude', status: 'available', version: '2.1.317' },
      { agent: 'codex', status: 'missing' },
      { agent: 'antigravity', status: 'credential-missing', version: '1.4.12' },
    ]);
    const app = Fastify();
    apps.push(app);
    registerProbeRoutes(app, { probes: { probeAll } });
    return { app, probeAll };
  }

  it('返回四态之一且禁止缓存', async () => {
    const { app } = await probeApp();
    const response = await app.inject('/api/agents/probes');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    for (const probe of response.json())
      expect(['available', 'missing', 'changed', 'credential-missing']).toContain(probe.status);
  });

  it('每次请求都重新探测，不缓存子进程结果', async () => {
    const { app, probeAll } = await probeApp();
    await app.inject('/api/agents/probes');
    await app.inject('/api/agents/probes');
    expect(probeAll).toHaveBeenCalledTimes(2);
  });
});
