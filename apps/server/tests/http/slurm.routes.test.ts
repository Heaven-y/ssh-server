import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { workspaceTerminalTarget, type SlurmSnapshot } from '@ssh-server/shared';
import { buildApp } from '../../src/http/app';
import { registerSlurmRoutes } from '../../src/http/slurm.routes';
import { createSlurmService } from '../../src/slurm/service';
import { startTerminalFixture } from '../../../../scripts/dev/terminal-fixture';
import { deferred, slurmHeader, slurmOutput } from '../slurm/fixture';

async function fixture(result = { stdout: slurmOutput(), exitCode: 0 }) {
  const root = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'slurm-http-'));
  const commands: string[] = [];
  const ssh = await startTerminalFixture({
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(root, 'workspace'),
    exec: (command) => {
      commands.push(command);
      return result;
    },
  });
  const service = createSlurmService(ssh);
  const app = await buildApp({
    token: 'fixture-token',
    port: 0,
    store: ssh.store,
    routes: (server) => registerSlurmRoutes(server, service),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = {
    host: new URL(app.listeningOrigin).host,
    origin: app.listeningOrigin,
    cookie: 'ssh_server_session=fixture-token',
  };
  const target = workspaceTerminalTarget(ssh.workspace);
  const base = `/api/workspaces/${ssh.workspace.id}/slurm`;
  const url = `${base}?target=${encodeURIComponent(JSON.stringify(target))}`;
  return {
    app,
    ssh,
    service,
    commands,
    headers,
    target,
    base,
    url,
    async close() {
      await app.close();
      await ssh.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it('真实本机 SSH 贯通固定 GET、Cookie/Host/Origin 安全检查与严格目标，拒绝其他动作', async () => {
  const f = await fixture();
  try {
    expect((await f.app.inject({ url: f.url, headers: { host: f.headers.host } })).statusCode).toBe(401);
    expect((await f.app.inject({ url: f.url, headers: { ...f.headers, host: 'invalid.example' } })).statusCode).toBe(
      403,
    );
    // 沿用现行 GET 来源规则：浏览器跨站标记被拒绝，Origin 白名单用于修改请求。
    expect(
      (
        await f.app.inject({
          url: f.url,
          headers: { ...f.headers, origin: 'https://invalid.example', 'sec-fetch-site': 'cross-site' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await f.app.inject({ method: 'POST', url: f.url, headers: { ...f.headers, origin: 'https://invalid.example' } }))
        .statusCode,
    ).toBe(403);
    for (const target of [
      undefined,
      'not-json',
      { ...f.target, workspaceId: 'other' },
      { ...f.target, command: 'scancel' },
    ]) {
      const url =
        target === undefined
          ? f.base
          : `${f.base}?target=${encodeURIComponent(typeof target === 'string' ? target : JSON.stringify(target))}`;
      expect((await f.app.inject({ url, headers: f.headers })).statusCode).toBe(400);
    }
    for (const method of ['POST', 'DELETE'] as const)
      expect((await f.app.inject({ method, url: f.url, headers: f.headers })).statusCode).toBe(404);
    expect(f.commands).toEqual([]);
    const response = await f.app.inject({ url: f.url, headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      status: 'available',
      sampledAt: expect.any(Number),
      output: `${slurmHeader}\n${slurmOutput().trimEnd()}`,
      truncated: false,
    });
    expect(f.commands).toEqual([
      'LC_ALL=C squeue --noheader --user="$(id -un)" --format="%.18i %.9P %.24j %.8u %.2t %.10M %.6D %R"',
    ]);
    await f.ssh.store.update(f.ssh.workspace.id, { remoteDir: '~/projects/changed' });
    expect((await f.app.inject({ url: f.url, headers: f.headers })).statusCode).toBe(409);
    await f.ssh.store.remove(f.ssh.workspace.id);
    expect((await f.app.inject({ url: f.url, headers: f.headers })).statusCode).toBe(404);
  } finally {
    await f.close();
  }
  await expect(f.service.get(f.target, new AbortController().signal)).rejects.toThrow();
});

it.each([
  { stdout: '', exitCode: 0, status: 'available' },
  { stdout: '', exitCode: 127, status: 'unavailable' },
  { stdout: '', exitCode: 1, status: 'error' },
  { stdout: '<文本> & "特殊字符"', exitCode: 0, status: 'available' },
])('HTTP 文本、空队列、未安装与失败不混淆：%j', async ({ stdout, exitCode, status }) => {
  const f = await fixture({ stdout, exitCode });
  try {
    const response = await f.app.inject({ url: f.url, headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status,
      output: status === 'available' && stdout ? `${slurmHeader}\n${stdout}` : '',
      sampledAt: expect.any(Number),
    });
    expect(response.json()).not.toHaveProperty('jobs');
    if (status !== 'available') expect(response.json().message).toEqual(expect.any(String));
    expect(f.commands).toEqual([
      'LC_ALL=C squeue --noheader --user="$(id -un)" --format="%.18i %.9P %.24j %.8u %.2t %.10M %.6D %R"',
    ]);
  } finally {
    await f.close();
  }
});

it('HTTP 客户端中断传递自己的 signal，preClose 释放服务', async () => {
  const f = await fixture();
  const started = deferred<AbortSignal>();
  const finished = deferred<SlurmSnapshot>();
  const dispose = vi.fn();
  const app = await buildApp({
    token: 'fixture-token',
    port: 0,
    store: f.ssh.store,
    routes: (server) =>
      registerSlurmRoutes(server, {
        get: async (_target, signal) => {
          started.resolve(signal);
          return finished.promise;
        },
        dispose,
      }),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const req = request(new URL(f.url, app.listeningOrigin), { headers: { cookie: 'ssh_server_session=fixture-token' } });
  req.on('error', () => undefined);
  req.end();
  try {
    const signal = await started.promise;
    expect(signal.aborted).toBe(false);
    req.destroy();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
  } finally {
    req.destroy();
    finished.resolve({ status: 'error', sampledAt: 0, output: '', truncated: false });
    await app.close();
    await f.close();
  }
  expect(dispose).toHaveBeenCalledOnce();
});
