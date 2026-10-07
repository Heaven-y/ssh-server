// 后端入口：读取配置、组装依赖、只在本机地址上启动
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSessionRegistry } from './chat/registry';
import { TurnManager } from './chat/turn-manager';
import { createSessionsService } from './chat/sessions';
import { createCapabilitiesService } from './chat/capabilities';
import { createTurnChanges } from './chat/turn-changes';
import { registerTurnChangesRoutes } from './http/turn-changes.routes';
import { runClaudeTurn } from './agents/claude-adapter';
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
import { registerDiscardRoutes, registerVersionRoutes } from './http/versions.routes';
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
import { createServerProfiles } from './ssh/profiles';
import { registerSshTargetRoutes } from './http/ssh-targets.routes';
import { registerHostTrustRoutes } from './http/ssh-host-trust.routes';
import { createHostTrust } from './ssh/host-trust';
import { createPasswordStore } from './ssh/password-store';
import { createWorkspaceStore } from './workspaces/store';
import { createWorkspacePolicy } from './workspaces/policy';
import { registerWorkspacePolicyRoutes } from './http/workspace-policy.routes';
import { createWorkspaceActivity } from './workspaces/activity';
import { createWorkspaceRemoval } from './workspaces/removal';
import { createWorkspaceRemovalResources } from './workspaces/removal-resources';
import { createWorkspaceSetup } from './workspaces/setup/service';
import { registerWorkspaceSetupRoutes } from './http/workspace-setup.routes';
import { createRcloneDriver } from './sync/rclone';
import { createSyncManager } from './sync/manager';
import { createNativeConfigService } from './settings/native-config';
import { createProductSettings } from './settings/product-settings';
import { registerProductSettingsRoutes } from './http/product-settings.routes';
import { createEnvironmentService } from './settings/environment';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

async function dirExists(p: string): Promise<boolean> {
  return stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

const hostForUrl = (host: string) => (host === '::1' ? '[::1]' : '127.0.0.1');

function accessUrl(host: string, port: number, devOrigin?: string): string {
  return `${devOrigin ?? `http://${hostForUrl(host)}:${port}`}/`;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  await mkdir(config.configDir, { recursive: true });
  const productSettings = createProductSettings({ configDir: config.configDir });
  const environment = createEnvironmentService();
  const startupEnvironment = environment.read();

  const targets = createServerTargets({ configDir: config.configDir });
  const store = createWorkspaceStore({
    configDir: config.configDir,
    dirExists,
    knownHosts: async () => (await targets.list()).map((server) => server.alias),
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
  const resources = createResourcesService({
    store,
    pool,
    settings: async () => (await productSettings.read()).settings,
  });
  const sync = createSyncManager({
    configDir: config.configDir,
    driver: createRcloneDriver({ configDir: config.configDir, pool }),
  });
  const registry = createSessionRegistry();
  const versions = createVersionsService();
  const changes = createTurnChanges({ configDir: config.configDir, versions });
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
  const removalResources = createWorkspaceRemovalResources({ editors, browse, preflights, tasks, sync, terminals });
  const profiles = createServerProfiles({ targets, store, activity, resources: removalResources, pool });
  const removal = createWorkspaceRemoval({ store, activity, ...removalResources });
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
    runners: { claude: runClaudeTurn, codex: runCodexTurn },
    internalUrl: () => `http://${hostForUrl(config.host)}:${port}`,
    sync,
    acquireWorkspace,
    changes,
  });

  const app = await buildApp({
    token: config.token,
    port: config.port,
    devOrigin: config.devOrigin,
    store,
    setup,
    activity,
    removal,
    webDir: WEB_DIST,
    routes: (a) => {
      registerInternalRoutes(a, { registry, getWorkspace: (id) => store.get(id), pool, sync });
      registerSessionRoutes(a, { store, sessions });
      registerCapabilityRoutes(a, { store, capabilities });
      registerSshRoutes(a, { pool, profiles });
      registerSshTargetRoutes(a, profiles);
      registerWorkspaceSetupRoutes(a, setup);
      registerHostTrustRoutes(a, createHostTrust({ pool }));
      registerAgentConfigRoutes(a, { service: createNativeConfigService() });
      registerProductSettingsRoutes(a, productSettings, environment);
      registerWorkspacePolicyRoutes(a, createWorkspacePolicy(store));
      registerFileRoutes(a, { store, files: createWorkspaceFilesService(), sync });
      registerFileEditorRoutes(a, { store, editors, acquireWorkspace });
      registerRemoteFileRoutes(a, browse);
      registerRemoteFileActionRoutes(a, { preflights, tasks, downloads: createFileDownloads({ pool, browse }) });
      registerVersionRoutes(a, { store, versions, sync });
      registerDiscardRoutes(a, { store, versions, sync });
      registerTurnChangesRoutes(a, { store, changes, sessions });
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
  console.log(`访问地址：${accessUrl(config.host, port, config.devOrigin)}`);
  const report = await startupEnvironment;
  for (const tool of report.tools)
    console.log(
      `${tool.name}：${tool.available ? `可执行（版本 ${tool.version ?? '未知'}）` : '不可执行，请打开产品设置查看安装与配置指引'}`,
    );
  console.log('环境检测仅验证程序可执行，未检查模型登录或调用模型，也未安装、升级软件。');

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
