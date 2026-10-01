// 后端入口：读取配置、组装依赖、只在本机地址上启动
import { mkdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { buildApp } from './http/app';
import { listHosts, parseSshConfig } from './ssh/ssh-config';
import { createWorkspaceStore } from './workspaces/store';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

async function dirExists(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isDirectory(), () => false);
}

/** 每次调用都重新读取 ~/.ssh/config，用户修改后无需重启 */
async function listSshHosts() {
  const home = os.homedir();
  const text = await readFile(path.join(home, '.ssh', 'config'), 'utf8').catch(() => '');
  return listHosts(parseSshConfig(text, home));
}

function accessUrl(host: string, port: number, token: string, devOrigin?: string): string {
  const base = devOrigin ?? `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}`;
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

  const app = await buildApp({
    token: config.token,
    port: config.port,
    devOrigin: config.devOrigin,
    store,
    listSshHosts,
    webDir: WEB_DIST,
  });

  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = addr && typeof addr === 'object' ? addr.port : config.port;
  console.log(`ssh-server 已启动，只监听 ${config.host}:${port}`);
  console.log(`访问地址：${accessUrl(config.host, port, config.token, config.devOrigin)}`);

  const shutdown = () => {
    app.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  console.error(`启动失败：${(e as Error).message}`);
  process.exit(1);
});
