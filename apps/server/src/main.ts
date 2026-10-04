// 后端入口：读取配置、组装依赖、只在本机地址上启动
import { mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionRegistry } from './chat/registry';
import { TurnManager } from './chat/turn-manager';
import { createSessionsService } from './chat/sessions';
import { createCapabilitiesService } from './chat/capabilities';
import { discoverClaudeCapabilities } from './agents/claude-capabilities';
import { createClaudeSessions } from './agents/claude-sessions';
import {
  runCodexTurn,
  listCodexSessions,
  readCodexSession,
  assertCodexSession,
  mutateCodexSession,
  discoverCodexCapabilities,
} from './agents/codex';
import { loadConfig } from './config';
import { buildApp } from './http/app';
import { registerInternalRoutes } from './http/internal.routes';
import { registerSessionRoutes } from './http/sessions.routes';
import { registerCapabilityRoutes } from './http/capabilities.routes';
import { registerSshRoutes } from './http/ssh.routes';
import { registerAgentConfigRoutes } from './http/agent-config.routes';
import { registerFileRoutes } from './http/files.routes';
import { registerFileEditorRoutes } from './http/file-editors.routes';
import { createFileEditors } from './files/editors';
import { createFileSyncCoordinator } from './remote-files/sync-coordinator';
import { registerRemoteFileRoutes } from './http/remote-files.routes';
import { registerRemoteFileActionRoutes } from './http/remote-file-actions.routes';
import { createRemoteExecutor } from './remote-files/executor';
import { createFilePreflights } from './remote-files/preflight';
import { createFileTasks } from './remote-files/tasks';
import { createFileDownloads } from './remote-files/downloads';
import { createRemoteFilesService } from './remote-files/service';
import { registerVersionRoutes } from './http/versions.routes';
import { createWorkspaceFilesService } from './files/service';
import { createVersionsService } from './vcs/service';
import { registerSyncRoutes } from './http/sync.routes';
import { registerWsRoutes } from './http/ws.routes';
import { registerTerminalRoutes } from './http/terminal.routes';
import { createTerminalBindings } from './terminal/binding';
import { createTerminalManager } from './terminal/manager';
import { registerResourcesRoutes } from './http/resources.routes';
import { createResourcesService } from './resources/service';
import { createSshPool } from './ssh/pool';
import { createServerTargets, serverHostConfig } from './ssh/targets';
import { registerSshTargetRoutes } from './http/ssh-targets.routes';
import { registerHostTrustRoutes } from './http/ssh-host-trust.routes';
import { createHostTrust } from './ssh/host-trust';
import { createPasswordStore } from './ssh/password-store';
import { listHosts, parseSshConfig } from './ssh/ssh-config';
import { createWorkspaceStore } from './workspaces/store';
import { createWorkspaceActivity } from './workspaces/activity';
import { createWorkspaceRemoval } from './workspaces/removal';
import { createWorkspaceRemovalResources } from './workspaces/removal-resources';
import { createWorkspaceSetup } from './workspaces/setup/service';
import { registerWorkspaceSetupRoutes } from './http/workspace-setup.routes';
import { createRcloneDriver } from './sync/rclone';
import { createSyncManager } from './sync/manager';
import { createNativeConfigService } from './settings/native-config';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

async function dirExists(p: string): Promise<boolean> {
  return stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/** 每次调用都重新读取 ~/.ssh/config，用户修改后无需重启 */
async function listConfiguredSshHosts() {
  const home = os.homedir();
  const text = await readFile(path.join(home, '.ssh', 'config'), 'utf8').catch(() => '');
  return listHosts(parseSshConfig(text, home));
}

const hostForUrl = (host: string) => (host === '::1' ? '[::1]' : '127.0.0.1');

function accessUrl(host: string, port: number, token: string, devOrigin?: string): string {
  const base = devOrigin ?? `http://${hostForUrl(host)}:${port}`;
  return `${base}/auth?token=${encodeURIComponent(token)}`;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  await mkdir(config.configDir, { recursive: true });

  const targets = createServerTargets({ configDir: config.configDir });
  const listSshHosts = async () => [
    ...(await listConfiguredSshHosts()).map((host) => ({ ...host, source: 'ssh-config' as const })),
    ...(await targets.list()).map((server) => ({
      alias: server.alias,
      name: server.name,
      hostname: server.hostname,
      user: server.username,
      port: server.port,
      source: 'manual' as const,
      unsupported: [],
    })),
  ];

  const store = createWorkspaceStore({
    configDir: config.configDir,
    dirExists,
    knownHosts: async () => (await listSshHosts()).map((h) => h.alias),
  });
  const pool = createSshPool({
    passwordStore: createPasswordStore({ configDir: config.configDir }),
    lookupHost: async (alias) => {
      const server = await targets.get(alias);
      return server ? serverHostConfig(server) : undefined;
    },
  });
  const terminalBindings = createTerminalBindings({ store, pool });
  const activity = createWorkspaceActivity();
  const acquireWorkspace = (id: string) => activity.acquire(id);
  const terminals = createTerminalManager({
    store,
    pool,
    bindings: terminalBindings,
    assertWorkspaceOpen: activity.assertOpen,
  });
  const resources = createResourcesService({ store, pool });
  const sync = createSyncManager({
    configDir: config.configDir,
    driver: createRcloneDriver({ configDir: config.configDir, pool }),
  });
  const registry = createSessionRegistry();
  const setup = createWorkspaceSetup({ store, pool, sync, configDir: config.configDir, acquireWorkspace });
  const browse = createRemoteFilesService({ store, pool });
  const executor = createRemoteExecutor(pool);
  const editors = createFileEditors(config.configDir, acquireWorkspace);
  const preflights = createFilePreflights({
    store,
    pool,
    browse,
    executor,
    syncAvailable: true,
    syncPaths: sync.remoteFiles.checkPaths,
  });
  const tasks = createFileTasks({
    configDir: config.configDir,
    preflights,
    executor,
    coordinator: createFileSyncCoordinator({ store, sync, editors }),
    acquireWorkspace,
    onCorrupt: (name) => console.warn('文件任务记录损坏，已保留原文件，未重放操作：', name),
  });
  const removal = createWorkspaceRemoval({
    store,
    activity,
    ...createWorkspaceRemovalResources({ editors, browse, preflights, tasks, sync, terminals }),
  });
  const capabilities = createCapabilitiesService({
    claude: (dir, signal) => discoverClaudeCapabilities(dir, { signal }),
    codex: (dir, signal) => discoverCodexCapabilities(dir, { signal }),
  });
  const sessions = createSessionsService(
    {
      claude: createClaudeSessions(),
      codex: {
        list: (dir, signal, archived) => listCodexSessions(dir, { signal, archived }),
        read: (id, dir, signal) => readCodexSession(id, dir, { signal }),
        assertBelongs: (id, dir, signal) => assertCodexSession(id, dir, { signal }),
        mutate: (id, dir, input) => mutateCodexSession(id, dir, input),
      },
    },
    { withIdleSession: (session, operation) => turns.withIdleSession(session, operation) },
  );
  let port = config.port;
  const turns: TurnManager = new TurnManager({
    getWorkspace: (id) => store.get(id),
    registry,
    sessions,
    capabilities,
    runners: { codex: runCodexTurn },
    internalUrl: () => `http://${hostForUrl(config.host)}:${port}`,
    sync,
    acquireWorkspace,
  });

  const app = await buildApp({
    token: config.token,
    port: config.port,
    devOrigin: config.devOrigin,
    store,
    listSshHosts,
    setup,
    activity,
    removal,
    webDir: WEB_DIST,
    routes: (a) => {
      registerInternalRoutes(a, { registry, getWorkspace: (id) => store.get(id), pool, sync });
      registerSessionRoutes(a, { store, sessions });
      registerCapabilityRoutes(a, { store, capabilities });
      registerSshRoutes(a, { pool });
      registerSshTargetRoutes(a, targets);
      registerWorkspaceSetupRoutes(a, setup);
      registerHostTrustRoutes(a, createHostTrust({ pool }));
      registerAgentConfigRoutes(a, { service: createNativeConfigService() });
      registerFileRoutes(a, { store, files: createWorkspaceFilesService(), sync });
      registerFileEditorRoutes(a, { store, editors, acquireWorkspace });
      registerRemoteFileRoutes(a, browse);
      registerRemoteFileActionRoutes(a, { preflights, tasks, downloads: createFileDownloads({ pool, browse }) });
      registerVersionRoutes(a, { store, versions: createVersionsService(), sync });
      registerSyncRoutes(a, { store, sync });
      registerWsRoutes(a, { turns });
      registerTerminalRoutes(a, { terminals, bindings: terminalBindings });
      registerResourcesRoutes(a, resources);
    },
  });

  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  port = addr && typeof addr === 'object' ? addr.port : config.port;
  console.log(`ssh-server 已启动，只监听 ${config.host}:${port}`);
  console.log(`访问地址：${accessUrl(config.host, port, config.token, config.devOrigin)}`);

  const shutdown = () => {
    terminals.dispose();
    resources.dispose();
    sync.dispose();
    pool.dispose();
    void turns.dispose().finally(() => app.close().finally(() => process.exit(0)));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  console.error(`启动失败：${(e as Error).message}`);
  process.exit(1);
});
