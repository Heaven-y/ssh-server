// 后端入口：读取配置、组装依赖、只在本机地址上启动
import { mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionRegistry } from './chat/registry';
import { TurnManager } from './chat/turn-manager';
import { loadConfig } from './config';
import { buildApp } from './http/app';
import { registerInternalRoutes } from './http/internal.routes';
import { registerSessionRoutes } from './http/sessions.routes';
import { registerSshRoutes } from './http/ssh.routes';
import { registerAgentConfigRoutes } from './http/agent-config.routes';
import { registerFileRoutes } from './http/files.routes';
import { createWorkspaceFilesService } from './files/service';
import { registerSyncRoutes } from './http/sync.routes';
import { registerWsRoutes } from './http/ws.routes';
import { createSshPool } from './ssh/pool';
import { createPasswordStore } from './ssh/password-store';
import { listHosts, parseSshConfig } from './ssh/ssh-config';
import { createWorkspaceStore } from './workspaces/store';
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
async function listSshHosts() {
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

  const store = createWorkspaceStore({
    configDir: config.configDir,
    dirExists,
    knownHosts: async () => (await listSshHosts()).map((h) => h.alias),
  });
  const pool = createSshPool({ passwordStore: createPasswordStore({ configDir: config.configDir }) });
  const sync = createSyncManager({
    configDir: config.configDir,
    driver: createRcloneDriver({ configDir: config.configDir, pool }),
  });
  const registry = createSessionRegistry();
  let port = config.port;
  const turns = new TurnManager({
    getWorkspace: (id) => store.get(id),
    registry,
    internalUrl: () => `http://${hostForUrl(config.host)}:${port}`,
    sync,
  });

  const app = await buildApp({
    token: config.token,
    port: config.port,
    devOrigin: config.devOrigin,
    store,
    listSshHosts,
    webDir: WEB_DIST,
    routes: (a) => {
      registerInternalRoutes(a, { registry, getWorkspace: (id) => store.get(id), pool, sync });
      registerSessionRoutes(a, { store });
      registerSshRoutes(a, { pool });
      registerAgentConfigRoutes(a, { service: createNativeConfigService() });
      registerFileRoutes(a, { store, files: createWorkspaceFilesService(), sync });
      registerSyncRoutes(a, { store, sync });
      registerWsRoutes(a, { turns });
    },
  });

  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  port = addr && typeof addr === 'object' ? addr.port : config.port;
  console.log(`ssh-server 已启动，只监听 ${config.host}:${port}`);
  console.log(`访问地址：${accessUrl(config.host, port, config.token, config.devOrigin)}`);

  const shutdown = () => {
    sync.dispose();
    pool.dispose();
    void app.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  console.error(`启动失败：${(e as Error).message}`);
  process.exit(1);
});
