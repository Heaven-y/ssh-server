// 启动配置：来自环境变量与命令行参数
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export type ServerConfig = {
  port: number;
  host: string;
  configDir: string;
  /** 访问令牌，打开页面时通过 /auth?token= 换取 Cookie */
  token: string;
  /** 开发时 Vite 的来源，如 http://127.0.0.1:5173 */
  devOrigin?: string;
};

export const DEFAULT_PORT = 4317;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function defaultConfigDir(env: NodeJS.ProcessEnv): string {
  const base = env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'ssh-server');
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`端口不合法：${raw}`);
  return port;
}

function argValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx === -1 ? undefined : argv[idx + 1];
}

/** argv 为去掉 node 与脚本路径后的参数 */
export function loadConfig(env: NodeJS.ProcessEnv, argv: string[]): ServerConfig {
  const host = env.SSH_SERVER_HOST || '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`只允许监听本机地址（127.0.0.1、::1、localhost），当前为 ${host}`);
  }
  const devRaw = argValue(argv, '--dev-origin') ?? env.SSH_SERVER_DEV_ORIGIN;
  return {
    port: parsePort(env.SSH_SERVER_PORT),
    host,
    configDir: env.SSH_SERVER_CONFIG_DIR || defaultConfigDir(env),
    token: env.SSH_SERVER_TOKEN || randomBytes(32).toString('base64url'),
    devOrigin: devRaw ? new URL(devRaw).origin : undefined,
  };
}
