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

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-terminal-'));
  const fixture = await startTerminalFixture({
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(root, 'workspace'),
  });
  const { id: _id, ...workspaceInput } = fixture.workspace;
  await fixture.store.create({ ...workspaceInput, name: '另一个工作区' });
  const bindings = createTerminalBindings(fixture);
  const terminals = createTerminalManager({ ...fixture, bindings });
  const token = randomBytes(24).toString('hex');
  const app = await buildApp({
    token,
    port: 0,
    store: fixture.store,
    listSshHosts: () => Promise.resolve([]),
    webDir: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
    routes: (server) => {
      registerSshRoutes(server, fixture);
      registerTerminalRoutes(server, { terminals, bindings });
      server.get('/api/workspaces/:id/sessions', () => Promise.resolve([]));
      server.get('/api/workspaces/:id/sync', () =>
        Promise.resolve({
          phase: 'uninitialized',
          deletions: [],
          conflicts: [],
          settings: SyncSettingsSchema.parse({}),
        }),
      );
      server.get('/api/workspaces/:id/versions', () =>
        Promise.resolve({ initialized: false, revision: 'fixture', changes: [], excluded: [] }),
      );
      server.get('/__fixture', () => Promise.resolve({ shells: fixture.shells }));
      server.get('/__fixture/sftp', async () => {
        const connection = await fixture.pool.resolveConnection({
          alias: fixture.workspace.sshHost,
          authMode: 'password',
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
  console.log(`网页终端验收地址：${app.listeningOrigin}/auth?token=${token}`);
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
