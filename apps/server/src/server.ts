import { createBuiltinPlugins } from './bootstrap/builtin-plugins';
import { createCliServices } from './bootstrap/cli-services';
// 可编程启动：读取配置、组装依赖、只在本机地址上启动，并返回关闭函数。
// CLI（main.ts）与 Electron 桌面壳共用这里，业务路由与清理路径保持原样。
import type { AgentProbe } from '@agentdeck/shared/conversation';
import type { FastifyInstance } from 'fastify';
import { mkdir, stat } from 'node:fs/promises';
import { createAgentProbes, createLocalRunner } from './agents/common/probe';
import { legacyConfigDir, type ServerConfig } from './config';
import { buildApp } from './http/app';
import { registerProbeRoutes } from './http/probe.routes';
import { registerProductSettingsRoutes } from './http/product-settings.routes';
import { registerProjectRoutes } from './http/projects.routes';
import { registerWsRoutes } from './http/ws.routes';
import type { ProcessRunner } from './platform/process/run';
import { createProductSettings } from './settings/product-settings';
import { createWorkspaceActivity } from './workspaces/activity';
import { importLegacyWorkspaces, type ImportReport } from './workspaces/import';
import { migrateLegacyConfig } from './workspaces/migrate-legacy';
import { createWorkspaceStore } from './workspaces/store';

/** 已启动的本机服务：地址固定带尾部斜杠，close 可重复调用。 */
export type StartedServer = { url: string; close: () => Promise<void> };

export type StartServerOptions = {
  /** 前端构建产物目录；不传则只提供接口，不托管页面 */
  webDir?: string;
  /** 旧数据目录；桌面壳与测试可用它隔离迁移来源 */
  legacyDir?: string;
  /** Agent 探测执行器；测试注入假执行器，避免启动本机真实 CLI */
  probeRunner?: ProcessRunner;
  /** 启动日志；默认写控制台 */
  log?: (message: string) => void;
  logError?: (message: string) => void;
};

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
function logLegacyImport(report: ImportReport, log: (message: string) => void): void {
  if (report.imported > 0 || report.skipped > 0) {
    log(
      `旧工作区配置导入：导入 ${report.imported} 条，跳过 ${report.skipped} 条${
        report.backupFiles.length > 0 ? '；原文件已备份为 .bak' : ''
      }`,
    );
  }
  if (report.message) log(`旧工作区配置导入：${report.message}`);
}

type MigrationReport = Awaited<ReturnType<typeof migrateLegacyConfig>>;

function logMigration(
  report: MigrationReport,
  log: (message: string) => void,
  logError: (message: string) => void,
): void {
  for (const name of report.copied) log(`已从旧数据目录迁移：${name}`);
  for (const name of report.keptExisting) log(`新数据目录已有 ${name}，保留现有文件未覆盖`);
  for (const message of report.errors) logError(`数据迁移：${message}`);
}

/** 启动日志只报本机事实：版本与四态，不打印路径、账号或任何探测输出。 */
function logProbe(probe: AgentProbe, log: (message: string) => void): void {
  const labels = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity' } as const;
  const statuses = {
    available: '可用',
    missing: '未找到',
    changed: '接口变化',
    'credential-missing': '凭据未配置',
  } as const;
  const version = probe.version ? `（版本 ${probe.version}）` : '';
  const detail = probe.message ? `；${probe.message}` : '';
  log(`${labels[probe.agent]}：${statuses[probe.status]}${version}${detail}`);
}

/**
 * 启动本机服务并返回访问地址。端口传 0 时由系统分配，实际端口从监听结果读取。
 * 关闭顺序沿用原 CLI：先停终端、资源、Slurm 与 SSH 池，再停轮次，最后关闭 Fastify。
 */
export async function startServer(config: ServerConfig, options: StartServerOptions = {}): Promise<StartedServer> {
  const log = options.log ?? ((message: string) => console.log(message));
  const logError = options.logError ?? ((message: string) => console.error(message));

  // 改名后首次启动：把旧目录里的服务器档案与工作区搬过来，旧目录原样保留。
  const migration = await migrateLegacyConfig({
    legacyDir: options.legacyDir ?? legacyConfigDir(process.env),
    configDir: config.configDir,
  });
  await mkdir(config.configDir, { recursive: true });
  logMigration(migration, log, logError);
  const productSettings = createProductSettings({ configDir: config.configDir });
  const probes = createAgentProbes({ run: options.probeRunner ?? createLocalRunner() });
  // 探测只用于启动日志，不阻塞窗口出现；接口被调用时会另行探测。
  const startupProbes = probes.probeAll();

  const store = createWorkspaceStore({
    configDir: config.configDir,
    dirExists,
    knownHosts: () => builtin.knownHosts(),
  });
  const activity = createWorkspaceActivity();
  const builtin = await createBuiltinPlugins({
    configDir: config.configDir,
    store,
    activity,
    productSettings,
    logError,
  });
  // 旧版 workspaces.json 的字段级转换：在本进程读写项目配置之前跑一次。
  // 没有文件或已经是新结构时为空报告；转换成功后原文件保留为 workspaces.json.bak。
  logLegacyImport(await importLegacyWorkspaces({ configDir: config.configDir, store }), log);
  const cli = createCliServices({ configDir: config.configDir, store, activity });
  const { turns } = cli;

  let app: FastifyInstance | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      // 每个资源独立释放；一个关闭失败不能阻止其余通道清理。
      await Promise.allSettled([cli.disposeSessionManagement(), builtin.dispose()]);
      // 启动探测最多跑 5 秒；关闭保持原有有界等待。
      await Promise.race([
        startupProbes,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2_000).unref();
        }),
      ]);
      try {
        await turns.dispose();
      } finally {
        await app?.close();
      }
    })();
    return closing;
  };

  try {
    app = await buildApp({
      token: config.token,
      port: config.port,
      devOrigin: config.devOrigin,
      webDir: options.webDir,
      routes: (a) => {
        registerProjectRoutes(a, { store, activity });
        builtin.registerRoutes(a);
        registerProbeRoutes(a, { probes });
        cli.registerRoutes(a);
        registerProductSettingsRoutes(a, productSettings, probes);
        registerWsRoutes(a, { turns });
      },
    });

    await app.listen({ host: config.host, port: config.port });
    const addr = app.server.address();
    const port = addr && typeof addr === 'object' ? addr.port : config.port;
    log(`AgentDeck 已启动，只监听 ${config.host}:${port}`);
    log(`访问地址：${accessUrl(config.host, port, config.devOrigin)}`);

    void startupProbes.then((report) => {
      for (const probe of report) logProbe(probe, log);
      log('本机探测只运行 --version、--help 与 Codex 的 schema 生成，不检查账号、不请求模型端点，也未安装或升级软件。');
    });

    return { url: accessUrl(config.host, port, config.devOrigin), close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
