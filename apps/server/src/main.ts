// 后端入口：读取配置、组装依赖、只在本机地址上启动
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AgentProbe } from '@agentdeck/shared';
import { TurnManager } from './chat/turn-manager';
import { createSessionsService } from './chat/sessions';
import { createCapabilitiesService } from './chat/capabilities';
import { runClaudeTurn } from './agents/claude-adapter';
import { discoverClaudeCapabilities } from './agents/claude-capabilities';
import { createClaudeSessions } from './agents/claude-sessions';
import {
  createCodexRunner,
  listCodexSessions,
  readCodexSession,
  assertCodexSession,
  mutateCodexSession,
  forkCodexSession,
  discoverCodexCapabilities,
} from './agents/codex';
import { legacyConfigDir, loadConfig } from './config';
import { buildApp } from './http/app';
import { registerSessionRoutes } from './http/sessions.routes';
import { registerCapabilityRoutes } from './http/capabilities.routes';
import { registerSshRoutes } from './http/ssh.routes';
import { registerAgentConfigRoutes } from './http/agent-config.routes';
import { registerRemoteFileRoutes } from './http/remote-files.routes';
import { registerRemoteFileActionRoutes } from './http/remote-file-actions.routes';
import { createRemoteExecutor } from './remote-files/executor';
import { createFilePreflights } from './remote-files/preflight';
import { createFileTasks } from './remote-files/tasks';
import { createFileDownloads } from './remote-files/downloads';
import { createRemoteFilesService } from './remote-files/service';
import { registerWsRoutes } from './http/ws.routes';
import { registerTerminalRoutes } from './http/terminal.routes';
import { createTerminalBindings } from './terminal/binding';
import { createTerminalManager } from './terminal/manager';
import { registerResourcesRoutes } from './http/resources.routes';
import { createResourcesService } from './resources/service';
import { registerSlurmRoutes } from './http/slurm.routes';
import { createSlurmService } from './slurm/service';
import { createSshPool } from './ssh/pool';
import { createServerTargets, serverHostConfig } from './ssh/targets';
import { createServerProfiles } from './ssh/profiles';
import { registerSshTargetRoutes } from './http/ssh-targets.routes';
import { registerHostTrustRoutes } from './http/ssh-host-trust.routes';
import { createHostTrust } from './ssh/host-trust';
import { createPasswordStore } from './ssh/password-store';
import { createWorkspaceStore } from './workspaces/store';
import { migrateLegacyConfig } from './workspaces/migrate-legacy';
import { importLegacyWorkspaces, type ImportReport } from './workspaces/import';
import { createWorkspaceActivity } from './workspaces/activity';
import { createNativeConfigService } from './settings/native-config';
import { createProductSettings } from './settings/product-settings';
import { registerProductSettingsRoutes } from './http/product-settings.routes';
import { createAgentProbes, createLocalRunner } from './agents/probe';

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

/** 启动日志只报数量与是否有备份，不打印项目清单。 */
function logLegacyImport(report: ImportReport): void {
  if (report.imported > 0 || report.skipped > 0) {
    console.log(
      `旧工作区配置导入：导入 ${report.imported} 条，跳过 ${report.skipped} 条${
        report.backupFiles.length > 0 ? '；原文件已备份为 .bak' : ''
      }`,
    );
  }
  if (report.message) console.warn(`旧工作区配置导入：${report.message}`);
}

/** 启动日志只报本机事实：版本与四态，不打印路径、账号或任何探测输出。 */
function logProbe(probe: AgentProbe): void {
  const labels = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' } as const;
  const statuses = {
    available: '可用',
    missing: '未找到',
    changed: '接口变化',
    'credential-missing': '凭据未配置',
  } as const;
  const version = probe.version ? `（版本 ${probe.version}）` : '';
  const detail = probe.message ? `；${probe.message}` : '';
  console.log(`${labels[probe.agent]}：${statuses[probe.status]}${version}${detail}`);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  // 改名后首次启动：把旧目录里的服务器档案与工作区搬过来，旧目录原样保留。
  const migration = await migrateLegacyConfig({
    legacyDir: legacyConfigDir(process.env),
    configDir: config.configDir,
  });
  await mkdir(config.configDir, { recursive: true });
  for (const name of migration.copied) console.log(`已从旧数据目录迁移：${name}`);
  for (const name of migration.keptExisting) console.log(`新数据目录已有 ${name}，保留现有文件未覆盖`);
  for (const message of migration.errors) console.error(`数据迁移：${message}`);
  const productSettings = createProductSettings({ configDir: config.configDir });
  const probes = createAgentProbes({ run: createLocalRunner() });
  const startupProbes = probes.probeAll();

  const targets = createServerTargets({ configDir: config.configDir });
  const store = createWorkspaceStore({
    configDir: config.configDir,
    dirExists,
    knownHosts: async () => (await targets.list()).map((server) => server.alias),
  });
  // 旧版 workspaces.json 的字段级转换：在本进程读写项目配置之前跑一次。
  // 没有文件或已经是新结构时为空报告；转换成功后原文件保留为 workspaces.json.bak。
  logLegacyImport(await importLegacyWorkspaces({ configDir: config.configDir, store }));
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
  });
  const resources = createResourcesService({
    store,
    pool,
    settings: async () => (await productSettings.read()).settings,
  });
  const slurm = createSlurmService({ store, pool });
  const browse = createRemoteFilesService({ store, pool });
  const executor = createRemoteExecutor(pool);
  const preflights = createFilePreflights({ store, pool, browse, executor });
  const tasks = createFileTasks({
    configDir: config.configDir,
    preflights,
    executor,
    acquireWorkspace,
    onCorrupt: (name) => console.warn('文件任务记录损坏，已保留原文件，未重放操作：', name),
  });
  const profiles = createServerProfiles({ targets, store, pool });
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
        fork: (id, dir, input) => forkCodexSession(id, dir, input),
      },
    },
    {
      withIdleSession: (session, operation) => turns.withIdleSession(session, operation),
      isRunning: (s) => turns.isRunning(s),
    },
  );
  const turns: TurnManager = new TurnManager({
    getWorkspace: (id) => store.get(id),
    sessions,
    capabilities,
    runners: { claude: runClaudeTurn, codex: createCodexRunner() },
    acquireWorkspace,
  });

  const app = await buildApp({
    token: config.token,
    port: config.port,
    devOrigin: config.devOrigin,
    store,
    webDir: WEB_DIST,
    routes: (a) => {
      registerSessionRoutes(a, { store, sessions });
      registerCapabilityRoutes(a, { store, capabilities });
      registerSshRoutes(a, { pool, profiles });
      registerSshTargetRoutes(a, profiles);
      registerHostTrustRoutes(a, createHostTrust({ pool }));
      registerAgentConfigRoutes(a, { service: createNativeConfigService() });
      registerProductSettingsRoutes(a, productSettings, probes);
      registerRemoteFileRoutes(a, browse);
      registerRemoteFileActionRoutes(a, { preflights, tasks, downloads: createFileDownloads({ pool, browse }) });
      registerWsRoutes(a, { turns });
      registerTerminalRoutes(a, { terminals, bindings: terminalBindings });
      registerResourcesRoutes(a, resources);
      registerSlurmRoutes(a, slurm);
    },
  });

  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = addr && typeof addr === 'object' ? addr.port : config.port;
  console.log(`AgentDeck 已启动，只监听 ${config.host}:${port}`);
  console.log(`访问地址：${accessUrl(config.host, port, config.devOrigin)}`);
  const report = await startupProbes;
  for (const probe of report) logProbe(probe);
  console.log(
    '本机探测只运行 --version、--help 与 Codex 的 schema 生成，不检查账号、不请求模型端点，也未安装或升级软件。',
  );

  const shutdown = () => {
    terminals.dispose();
    resources.dispose();
    slurm.dispose();
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
