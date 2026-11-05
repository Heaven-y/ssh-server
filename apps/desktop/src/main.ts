// Electron 主进程：单实例、拉起本机后端、用窗口加载它；关窗后先释放后端再退出。
// 业务代码全在后端，这里只负责启动方式与窗口生命周期。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { loadConfig } from '../../server/src/config';
import { startServer, type StartedServer } from '../../server/src/server';
import { acquireSingleInstance, createShutdown, resolveWindowUrl } from './lifecycle';
import { desktopPaths, externalWebLink, navigationAllowed, rendererAddress } from './paths';
import { APP_MENU_CHANNEL, SELECT_DIRECTORY_CHANNEL, TITLE_BAR_THEME_CHANNEL } from './bridge';
import { createDirectoryPicker } from './directory-picker';
import { applicationMenuTemplate, createWindowChrome, desktopChromeOptions } from './window-chrome';

/** 安装版页面跟随 resources 分发，开发版沿用工作区构建目录。 */
const paths = desktopPaths({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  mainDirectory: import.meta.dirname,
});
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
    ...desktopChromeOptions(),
    webPreferences: {
      preload: paths.preload,
      // 渲染层不开 Node：业务经 HTTP 通信，桌面能力通过受限的 preload 提供。
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const applicationMenu = Menu.buildFromTemplate(applicationMenuTemplate());
  Menu.setApplicationMenu(applicationMenu);
  window.setMenuBarVisibility(false);
  const chrome = createWindowChrome(window, url, (name, position) => {
    const menu = applicationMenu.getMenuItemById(name)?.submenu;
    if (!menu) return Promise.reject(new Error('应用菜单不存在。'));
    return new Promise<void>((resolve) => menu.popup({ window, ...position, callback: resolve }));
  });
  ipcMain.handle(APP_MENU_CHANNEL, chrome.showMenu);
  ipcMain.handle(TITLE_BAR_THEME_CHANNEL, chrome.setTheme);
  const directoryPicker = createDirectoryPicker(window, url, (options) => dialog.showOpenDialog(window, options));
  ipcMain.handle(SELECT_DIRECTORY_CHANNEL, directoryPicker.select);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    directoryPicker.invalidate();
    ipcMain.removeHandler(SELECT_DIRECTORY_CHANNEL);
    ipcMain.removeHandler(APP_MENU_CHANNEL);
    ipcMain.removeHandler(TITLE_BAR_THEME_CHANNEL);
    mainWindow = undefined;
  });
  window.webContents.on('did-start-navigation', (_event, _target, _inPlace, isMainFrame) => {
    if (isMainFrame) directoryPicker.invalidate();
  });
  // 外链交给系统浏览器；窗口自身只加载本机服务。
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (externalWebLink(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, target) => {
    if (navigationAllowed(url, target)) return;
    event.preventDefault();
    if (externalWebLink(target)) void shell.openExternal(target);
  });
  void window.loadURL(url);
  return window;
}

async function startDesktop(): Promise<void> {
  const config = loadConfig(process.env, process.argv.slice(2));
  const rendererUrl = rendererAddress(app.isPackaged, process.env.ELECTRON_RENDERER_URL);
  // 没有渲染器地址时必须已有前端构建产物，否则窗口只会看到 404。
  if (!rendererUrl && !existsSync(path.join(paths.web, 'index.html'))) {
    throw new Error(
      app.isPackaged
        ? '安装文件不完整，缺少页面资源，请重新解压或安装 AgentDeck'
        : '缺少前端构建产物 apps/web/dist，请先运行 npm run build -w @agentdeck/web',
    );
  }
  // Vite 开发代理需要固定端口；安装版和静态预览仍由系统分配空闲端口。
  if (rendererUrl && config.port === 0)
    throw new Error('桌面热更新需要固定后端端口，请将 AGENTDECK_PORT 设置为 1–65535。');
  const started = await startServer(
    {
      ...config,
      port: rendererUrl ? config.port : 0,
      devOrigin: rendererUrl ? new URL(rendererUrl).origin : config.devOrigin,
    },
    { webDir: paths.web },
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
