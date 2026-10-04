// 隔离的真实ssh2/SFTP网页夹具；同步和远端清单为合成结果，真实rclone另行验收。
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyncSettingsSchema, type SyncStatus, type Workspace } from '@ssh-server/shared';
import { startRemoteSftpFixture } from '../../apps/server/tests/helpers/remote-sftp';
import { createSshPool } from '../../apps/server/src/ssh/pool';
import { createPasswordStore } from '../../apps/server/src/ssh/password-store';
import { createServerTargets, serverHostConfig } from '../../apps/server/src/ssh/targets';
import { createHostTrust } from '../../apps/server/src/ssh/host-trust';
import { createWorkspaceStore } from '../../apps/server/src/workspaces/store';
import { createWorkspaceSetup } from '../../apps/server/src/workspaces/setup/service';
import { registerWorkspaceSetupRoutes } from '../../apps/server/src/http/workspace-setup.routes';
import { registerHostTrustRoutes } from '../../apps/server/src/http/ssh-host-trust.routes';
import { registerSshTargetRoutes } from '../../apps/server/src/http/ssh-targets.routes';
import { registerSshRoutes } from '../../apps/server/src/http/ssh.routes';
import { buildApp } from '../../apps/server/src/http/app';

export async function startSetupFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-setup-'));
  const ssh = await startRemoteSftpFixture();
  const configDir = path.join(root, 'config');
  const localDir = path.join(root, 'local');
  const homeDir = path.join(root, 'home');
  await mkdir(path.join(homeDir, '.ssh'), { recursive: true });
  await mkdir(path.join(localDir, 'scripts'), { recursive: true });
  await writeFile(path.join(localDir, 'train.py'), 'print(1)\n');
  await writeFile(path.join(localDir, 'weights.pt'), 'excluded');
  await writeFile(
    path.join(homeDir, '.ssh', 'config'),
    `Host my-server\n HostName 127.0.0.1\n Port ${ssh.port}\n User demo\n`,
  );
  await writeFile(path.join(homeDir, '.ssh', 'known_hosts'), '');
  const targets = createServerTargets({ configDir, homeDir });
  const pool = createSshPool({
    homeDir,
    passwordStore: createPasswordStore({ configDir }),
    lookupHost: async (alias) => {
      const target = await targets.get(alias);
      return target ? serverHostConfig(target) : undefined;
    },
  });
  const listSshHosts = async () => [
    {
      alias: 'my-server',
      hostname: '127.0.0.1',
      port: ssh.port,
      user: 'demo',
      unsupported: [],
      source: 'ssh-config' as const,
    },
    ...(await targets.list()).map((target) => ({
      alias: target.alias,
      name: target.name,
      hostname: target.hostname,
      port: target.port,
      user: target.username,
      unsupported: [],
      source: 'manual' as const,
    })),
  ];
  const store = createWorkspaceStore({
    configDir,
    knownHosts: async () => (await listSshHosts()).map((host) => host.alias),
    dirExists: (directory) =>
      stat(directory).then(
        (info) => info.isDirectory(),
        () => false,
      ),
  });
  const state = {
    initializationFailure: false,
    initializations: 0,
    previews: 0,
    localDir,
    remoteDir: ssh.root,
    fixturePort: ssh.port,
  };
  const syncStatus = (workspace: Workspace): SyncStatus => ({
    phase: state.initializationFailure ? 'error' : 'ready',
    message: state.initializationFailure ? '合成初始化失败，工作区已保留' : undefined,
    deletions: [],
    conflicts: [],
    settings: SyncSettingsSchema.parse(workspace.sync ?? {}),
  });
  const setup = createWorkspaceSetup({
    store,
    pool,
    configDir,
    sync: {
      initialize: (workspace) => {
        state.initializations++;
        return Promise.resolve(syncStatus(workspace));
      },
      status: (workspace) => Promise.resolve(syncStatus(workspace)),
    },
    remoteMetadata: () => {
      state.previews++;
      return Promise.resolve([
        { path: 'train.py', size: 10, modTime: '2026-10-05T00:00:00Z' },
        { path: 'weights.pt', size: 20000000, modTime: '2026-10-05T00:00:00Z' },
      ]);
    },
  });
  const trust = createHostTrust({ pool, homeDir });
  const token = randomBytes(24).toString('hex');
  const app = await buildApp({
    token,
    port: 0,
    store,
    setup,
    listSshHosts,
    webDir: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
    routes: (server) => {
      registerSshRoutes(server, { pool });
      registerSshTargetRoutes(server, targets);
      registerHostTrustRoutes(server, trust);
      registerWorkspaceSetupRoutes(server, setup);
      server.get('/api/workspaces/:id/sessions', () => []);
      server.get<{ Params: { id: string } }>('/api/workspaces/:id/sync', async (request) => {
        const workspace = await store.get(request.params.id);
        return workspace ? syncStatus(workspace) : undefined;
      });
      server.get('/api/workspaces/:id/versions', () => ({
        initialized: false,
        revision: 'fixture',
        changes: [],
        excluded: [],
      }));
      server.get('/__fixture', () => ({ ...state, audit: ssh.audit, resources: ssh.resources() }));
      server.post<{ Body: { failure: boolean } }>('/__fixture/initialization-failure', (request) => {
        state.initializationFailure = request.body.failure;
        return state;
      });
      server.get('/ws', { websocket: true }, (socket) => {
        socket.on('error', () => undefined);
        socket.on('message', (data) => socket.send(data));
      });
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    app,
    pool,
    store,
    targets,
    trust,
    setup,
    state,
    ssh,
    root,
    configDir,
    homeDir,
    localDir,
    url: `${app.listeningOrigin}/auth?token=${token}`,
    async close() {
      trust.dispose();
      await app.close();
      pool.dispose();
      await ssh.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
