// 后端 CLI 入口：读取配置并启动服务；桌面壳复用 src/server.ts 的 startServer。
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { startServer } from './server';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  const server = await startServer(config, { webDir: WEB_DIST });
  const shutdown = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  console.error(`启动失败：${(e as Error).message}`);
  process.exit(1);
});
