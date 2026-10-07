import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { workspaceTerminalTarget } from '@ssh-server/shared';
import { buildApp } from '../../src/http/app';
import { registerResourcesRoutes } from '../../src/http/resources.routes';
import { createResourcesService } from '../../src/resources/service';
import { createResourceFixture } from '../../../../scripts/dev/resource-fixture';
import { startTerminalFixture } from '../../../../scripts/dev/terminal-fixture';

it('真实SSH资源通道贯通安全HTTP、固定目标及关闭服务生命周期', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'resources-http-'));
  const metrics = createResourceFixture();
  const ssh = await startTerminalFixture({
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(root, 'workspace'),
    exec: metrics.exec,
  });
  const resources = createResourcesService(ssh);
  const app = await buildApp({
    token: 'fixture-token',
    port: 0,
    store: ssh.store,
    routes: (server) => registerResourcesRoutes(server, resources),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = {
    host: new URL(app.listeningOrigin).host,
    origin: app.listeningOrigin,
    cookie: 'ssh_server_session=fixture-token',
  };
  const target = workspaceTerminalTarget(ssh.workspace);
  const base = `/api/workspaces/${ssh.workspace.id}/resources`;
  const url = `${base}?target=${encodeURIComponent(JSON.stringify(target))}`;
  try {
    expect((await app.inject({ url, headers: { host: headers.host } })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { ...headers, host: 'invalid.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: base, headers })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          url: base + '?target=' + encodeURIComponent(JSON.stringify({ ...target, workspaceId: 'other' })),
          headers,
        })
      ).statusCode,
    ).toBe(400);
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().host.data).toMatchObject({ hostname: 'fixture-node', cpuPercent: null });
    expect(response.json().disk.data.availableBytes).toBe(6144000);
    expect(metrics.state).toMatchObject({ hostSamples: 1, diskSamples: 1 });
    await ssh.store.update(ssh.workspace.id, { remoteDir: '~/projects/changed' });
    expect((await app.inject({ url, headers })).json()).toMatchObject({ code: 'target_changed' });
    await ssh.store.remove(ssh.workspace.id);
    expect((await app.inject({ url, headers })).statusCode).toBe(404);
  } finally {
    await app.close();
    await expect(resources.get(target)).rejects.toThrow();
    await ssh.close();
    await rm(root, { recursive: true, force: true });
  }
});
