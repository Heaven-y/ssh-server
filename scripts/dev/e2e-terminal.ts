// 使用已构建的网页和隔离的本机 SSH 夹具，供浏览器验收使用。
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncSettingsSchema } from '@ssh-server/shared';
import { buildApp } from '../../apps/server/src/http/app';
import { registerSshRoutes } from '../../apps/server/src/http/ssh.routes';
import { registerTerminalRoutes } from '../../apps/server/src/http/terminal.routes';
import { createTerminalBindings } from '../../apps/server/src/terminal/binding';
import { createTerminalManager } from '../../apps/server/src/terminal/manager';
import { resolveTerminalDirectory } from '../../apps/server/src/terminal/directory';
import { startTerminalFixture } from './terminal-fixture';
import { createResourceFixture } from './resource-fixture';
import { createResourcesService } from '../../apps/server/src/resources/service';
import { registerResourcesRoutes } from '../../apps/server/src/http/resources.routes';
import { createServerProfiles } from '../../apps/server/src/ssh/profiles';
import { createWorkspaceActivity } from '../../apps/server/src/workspaces/activity';
import { registerSshTargetRoutes } from '../../apps/server/src/http/ssh-targets.routes';
import { createEnvironmentService } from '../../apps/server/src/settings/environment';
import { createProductSettings } from '../../apps/server/src/settings/product-settings';
import { registerProductSettingsRoutes } from '../../apps/server/src/http/product-settings.routes';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-terminal-'));
  const metrics = createResourceFixture();
  const fixture = await startTerminalFixture({
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(root, 'workspace'),
    exec: metrics.exec,
  });
  const { id: _id, ...workspaceInput } = fixture.workspace;
  await fixture.store.create({ ...workspaceInput, name: '另一个工作区' });
  const bindings = createTerminalBindings(fixture);
  const terminals = createTerminalManager({ ...fixture, bindings });
  const resources = createResourcesService(fixture);
  const activity = createWorkspaceActivity();
  const profiles = createServerProfiles({ ...fixture, activity, resources: { blockers: () => Promise.resolve([]) } });
  const syncStatus = () =>
    Promise.resolve({
      phase: 'uninitialized',
      deletions: [],
      conflicts: [],
      settings: SyncSettingsSchema.parse({}),
    });
  const versionStatus = () => Promise.resolve({ initialized: false, revision: 'fixture', changes: [], excluded: [] });
  const token = randomBytes(24).toString('hex');
  const app = await buildApp({
    token,
    port: 0,
    activity,
    store: fixture.store,
    webDir: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
    routes: (server) => {
      registerSshRoutes(server, { ...fixture, profiles });
      registerSshTargetRoutes(server, profiles);
      registerProductSettingsRoutes(
        server,
        createProductSettings({ configDir: path.join(root, 'config') }),
        createEnvironmentService(() => Promise.resolve({ checkedAt: Date.now(), tools: [] })),
      );
      registerTerminalRoutes(server, { terminals, bindings });
      registerResourcesRoutes(server, resources);
      server.get('/api/workspaces/:id/sessions', () => Promise.resolve([]));
      server.get('/api/workspaces/:id/sync', syncStatus);
      server.post('/api/workspaces/:id/sync', syncStatus);
      server.get('/api/workspaces/:id/versions', versionStatus);
      server.post('/api/workspaces/:id/versions/initialize', versionStatus);
      server.get('/__fixture', () => Promise.resolve({ shells: fixture.shells, resources: metrics.state }));
      server.post<{ Body: { failure: boolean } }>('/__fixture/resource-failure', (req) => {
        metrics.state.failure = req.body.failure;
        return metrics.state;
      });
      server.get('/__fixture/sftp', async () => {
        const connection = await fixture.pool.resolveConnection({
          alias: fixture.workspace.sshHost,
        });
        const root = await resolveTerminalDirectory({
          workspace: fixture.workspace,
          pool: fixture.pool,
          guard: {
            generation: fixture.pool.generation(fixture.workspace.sshHost),
            cacheKey: connection.cacheKey,
            signal: new AbortController().signal,
          },
        });
        return { root };
      });
      server.get('/ws', { websocket: true }, (socket) => {
        socket.on('error', () => undefined);
        socket.on('message', (data) => socket.send(data));
      });
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  console.log(`网页终端验收地址：${app.listeningOrigin}/`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    terminals.dispose();
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  };
  process.once('SIGINT', () => {
    void close();
  });
  process.once('SIGTERM', () => {
    void close();
  });
}
main().catch(() => {
  console.error('终端本机夹具启动失败');
  process.exitCode = 1;
});
