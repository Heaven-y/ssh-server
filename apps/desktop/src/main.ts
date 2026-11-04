// Electron 主进程：单实例、拉起本机后端、用窗口加载它；关窗后先释放后端再退出。
// 业务代码全在后端，这里只负责启动方式与窗口生命周期。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { loadConfig } from '../../server/src/config';
import { startServer, type StartedServer } from '../../server/src/server';
import { acquireSingleInstance, createShutdown, resolveWindowUrl } from './lifecycle';

/** 前端构建产物：apps/web/dist，由 npm run dev:desktop 先构建。
 *  以下两个路径按打包产物 apps/desktop/out/main/main.js 计算，源码不单独运行。 */
const WEB_DIST = path.join(import.meta.dirname, '../../../web/dist');
const PRELOAD = path.join(import.meta.dirname, '../preload/preload.cjs');
/** 释放后端的最长等待：超时也退出，端口随进程结束由系统回收，不留后台进程。 */
const CLOSE_TIMEOUT_MS = 8_000;

let mainWindow: BrowserWindow | undefined;
let server: StartedServer | undefined;

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    // 先隐藏，等首屏画好再显示，避免白屏闪烁。
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'AgentDeck',
    webPreferences: {
      preload: PRELOAD,
      // 渲染层不开 Node：页面只经 HTTP 与后端通信。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    mainWindow = undefined;
  });
  // 外链交给系统浏览器；窗口自身只加载本机服务。
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });
  void window.loadURL(url);
  return window;
}

/** 开发期的渲染器地址只在本机回环上，取其来源交给后端做 Origin 校验。 */
function devOriginOf(rendererUrl: string | undefined): string | undefined {
  if (!rendererUrl) return undefined;
  try {
    return new URL(rendererUrl).origin;
  } catch {
    return undefined;
  }
}

async function startDesktop(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  // 没有渲染器地址时必须已有前端构建产物，否则窗口只会看到 404。
  if (!rendererUrl && !existsSync(path.join(WEB_DIST, 'index.html'))) {
    throw new Error('缺少前端构建产物 apps/web/dist，请先运行 npm run build -w @agentdeck/web');
  }
  // 端口固定用 0：由系统分配，避免和正在运行的开发服务抢端口。
  const started = await startServer(
    { ...config, port: 0, devOrigin: devOriginOf(rendererUrl) ?? config.devOrigin },
    { webDir: WEB_DIST },
  );
  server = started;
  mainWindow = createMainWindow(resolveWindowUrl(started.url, rendererUrl));
}

function failStartup(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`桌面壳启动失败：${message}`);
  dialog.showErrorBox('AgentDeck 启动失败', message);
  app.quit();
}

const shutdown = createShutdown({
  close: async () => {
    const started = server;
    server = undefined;
    if (!started) return;
    await Promise.race([
      started.close(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, CLOSE_TIMEOUT_MS);
      }),
    ]);
  },
  quit: () => app.quit(),
});

app.on('window-all-closed', () => {
  void shutdown.exitAfterClose();
});

// 直接退出（如任务栏关闭）时也先释放后端；放行后不再拦截。
app.on('before-quit', (event) => {
  if (shutdown.preventQuitUntilClosed()) {
    event.preventDefault();
    void shutdown.exitAfterClose();
  }
});

const singleInstance = acquireSingleInstance({
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
});

if (singleInstance) {
  app.on('second-instance', focusMainWindow);
  app.whenReady().then(
    () => startDesktop().catch(failStartup),
    (error: unknown) => failStartup(error),
  );
}
