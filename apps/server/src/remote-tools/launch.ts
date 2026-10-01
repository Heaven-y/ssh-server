// 计算启动 remote-tools MCP 子进程的命令：当前 node + tsx 加载器 + 入口文件（都用绝对路径）
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MCP_SERVER_NAME = 'ssh-server';

function tsxLoaderUrl(): string {
  try {
    return import.meta.resolve('tsx/esm');
  } catch {
    return pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
  }
}

export function resolveRemoteToolsCommand(): { command: string; args: string[] } {
  const entry = fileURLToPath(new URL('./main.ts', import.meta.url));
  return { command: process.execPath, args: ['--import', tsxLoaderUrl(), entry] };
}
