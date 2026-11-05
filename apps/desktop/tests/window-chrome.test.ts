import { expect, it, vi } from 'vitest';
import { applicationMenuTemplate, createWindowChrome, desktopChromeOptions } from '../src/window-chrome';

const url = 'http://127.0.0.1:4317/';
function setup() {
  const frame = { url };
  const contents = { isDestroyed: () => false, mainFrame: frame, getZoomFactor: () => 1.25 };
  const owner = {
    isDestroyed: () => false,
    webContents: contents,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    setTitleBarOverlay: vi.fn(),
  };
  const popup = vi.fn(async () => {});
  return {
    frame,
    owner,
    popup,
    request: { sender: contents, senderFrame: frame },
    chrome: createWindowChrome(owner, url, popup, 'win32'),
  };
}

it('自定义顶栏保留原生系统按钮和 File/Edit/View/Window 菜单角色', () => {
  expect(desktopChromeOptions('win32')).toMatchObject({
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 40 },
    autoHideMenuBar: false,
  });
  expect(applicationMenuTemplate('win32').map(({ id, role }) => ({ id, role }))).toEqual([
    { id: 'file', role: 'fileMenu' },
    { id: 'edit', role: 'editMenu' },
    { id: 'view', role: 'viewMenu' },
    { id: 'window', role: 'windowMenu' },
  ]);
  expect(desktopChromeOptions('darwin')).toHaveProperty('titleBarStyle', 'hiddenInset');
  expect(applicationMenuTemplate('darwin')[0]?.role).toBe('appMenu');
});

it('菜单只接受具名入口，位置按页面缩放转换并限制在窗口内', async () => {
  const { chrome, popup, request } = setup();
  await chrome.showMenu(request, 'edit', { x: 100, y: 32 });
  expect(popup).toHaveBeenCalledWith('edit', { x: 125, y: 40 });
  await chrome.showMenu(request, 'view', { x: -10, y: 10000 });
  expect(popup).toHaveBeenLastCalledWith('view', { x: 0, y: 800 });
  await expect(chrome.showMenu(request, 'execute-script', { x: 1, y: 1 })).rejects.toThrow('应用菜单不存在');
  await expect(chrome.showMenu(request, 'file', { x: NaN, y: 1 })).rejects.toThrow('菜单位置无效');
});

it('插件 frame、其他窗口和跨源页面不能调用菜单或主题能力', async () => {
  const { chrome, owner, frame, popup, request } = setup();
  for (const invalid of [
    { ...request, sender: {} },
    { ...request, senderFrame: { url } },
    { ...request, senderFrame: null },
  ]) {
    await expect(chrome.showMenu(invalid, 'file', { x: 1, y: 1 })).rejects.toThrow('当前页面不能操作');
    expect(() => chrome.setTheme(invalid, 'dark')).toThrow('当前页面不能操作');
  }
  frame.url = 'https://example.invalid/';
  await expect(chrome.showMenu(request, 'file', { x: 1, y: 1 })).rejects.toThrow('当前页面不能操作');
  frame.url = url;
  owner.isDestroyed = () => true;
  expect(() => chrome.setTheme(request, 'light')).toThrow('当前页面不能操作');
  expect(popup).not.toHaveBeenCalled();
  expect(owner.setTitleBarOverlay).not.toHaveBeenCalled();
});

it('同一时间只弹出一个菜单，关闭后可再次打开；主题只接受 light/dark', async () => {
  const { chrome, owner, popup, request } = setup();
  let release!: () => void;
  popup.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = chrome.showMenu(request, 'file', { x: 1, y: 1 });
  await chrome.showMenu(request, 'edit', { x: 1, y: 1 });
  expect(popup).toHaveBeenCalledTimes(1);
  release();
  await pending;
  await chrome.showMenu(request, 'view', { x: 1, y: 1 });
  expect(popup).toHaveBeenCalledTimes(2);
  chrome.setTheme(request, 'dark');
  expect(owner.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#1b1b1c', symbolColor: '#f9fafb' });
  expect(() => chrome.setTheme(request, { color: 'red' })).toThrow('标题栏主题无效');
});
