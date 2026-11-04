// 桌面壳构建配置：主进程把后端源码一起打包，preload 单独打成 CJS。
// 第三方依赖保持外部（安装包按 desktop 的生产依赖收集），本仓库源码一律打进产物，
// 包括走 workspace 软链的 @agentdeck/shared —— 它是 TS 源码，必须由打包器处理。
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/** 运行时依赖：与 apps/server 的 package.json 保持一致，另加 Electron 自身。 */
const MAIN_EXTERNALS = [
  'electron',
  'fastify',
  'zod',
  'ssh2',
  'ssh-config',
  'smol-toml',
  'csv-parse/sync',
  '@fastify/static',
  '@fastify/websocket',
  '@anthropic-ai/claude-agent-sdk',
];

/** 后端在模块加载时读取 remote-helper.py，打包后要放到与主进程入口同级的目录。 */
function copyRemoteHelper(): Plugin {
  return {
    name: 'agentdeck-copy-remote-helper',
    async closeBundle() {
      const target = path.join(projectRoot, 'out/main');
      await mkdir(target, { recursive: true });
      await copyFile(
        path.resolve(projectRoot, '../server/src/remote-files/remote-helper.py'),
        path.join(target, 'remote-helper.py'),
      );
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: path.join(projectRoot, 'src/main.ts'),
        external: MAIN_EXTERNALS,
      },
    },
    plugins: [copyRemoteHelper()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: path.join(projectRoot, 'src/preload.ts'),
        // 渲染层保持沙箱，所以 preload 必须是 CommonJS。
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
});
