// 桌面壳构建配置：主进程把后端源码一起打包，preload 单独打成 CJS。
// 第三方依赖保持外部（安装包按 desktop 的生产依赖收集），本仓库源码一律打进产物，
// 包括走 workspace 软链的 @agentdeck/shared —— 它是 TS 源码，必须由打包器处理。
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import webConfig from '../web/vite.config';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const webRoot = path.resolve(projectRoot, '../web');

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
  /^@modelcontextprotocol\/sdk(?:\/|$)/,
];

/** 后端在模块加载时读取 remote-helper.py，打包后要放到与主进程入口同级的目录。 */
function copyRemoteHelper(): Plugin {
  const source = path.resolve(
    projectRoot,
    '../server/src/builtin-plugins/ssh-console/legacy/remote-files/remote-helper.py',
  );
  return {
    name: 'agentdeck-copy-remote-helper',
    buildStart() {
      this.addWatchFile(source);
    },
    async writeBundle() {
      const target = path.join(projectRoot, 'out/main');
      await mkdir(target, { recursive: true });
      // 在 closeBundle 触发 Electron 重启前完成复制。
      await copyFile(source, path.join(target, 'remote-helper.py'));
    },
  };
}

export default defineConfig(({ command }) => ({
  main: {
    build: {
      rollupOptions: {
        input: {
          main: path.join(projectRoot, 'src/main.ts'),
          'session-tools': path.resolve(projectRoot, '../server/src/session-tools/main.ts'),
        },
        external: MAIN_EXTERNALS,
        output: { entryFileNames: ({ name }) => (name === 'session-tools' ? 'session-tools.mjs' : '[name].js') },
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
  // 开发窗口直接读取 Vite 源码服务；正式网页仍由 web workspace 单独构建和打包。
  renderer:
    command === 'serve'
      ? {
          ...webConfig,
          root: webRoot,
          build: { rolldownOptions: { input: path.join(webRoot, 'index.html') } },
        }
      : undefined,
}));
