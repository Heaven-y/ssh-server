// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
async function preferences() {
  vi.resetModules();
  return (await import('../../src/ui/ui-preferences')).useUiPreferences;
}
it('偏好保存主题和折叠前宽度，折叠零宽与极端数值不污染重开布局', async () => {
  const store = await preferences();
  expect(store.getState().theme).toBe('light');
  store.getState().toggleTheme();
  store.getState().setWidth('sidebarWidth', 280);
  store.getState().setWidth('fileWidth', 480);
  store.getState().setSidebarCollapsed(true);
  store.getState().setWidth('sidebarWidth', 0);
  store.getState().setWidth('fileWidth', Infinity);
  const restored = await preferences();
  expect(restored.getState()).toMatchObject({
    theme: 'dark',
    sidebarCollapsed: true,
    sidebarWidth: 280,
    fileWidth: 480,
  });
});
it.each([
  '{',
  '{"version":2}',
  '{"version":1,"theme":"light","sidebarCollapsed":false,"sidebarWidth":-1,"fileWidth":420}',
])('坏或不支持的存储恢复可用默认布局：%s', async (value) => {
  localStorage.setItem('ssh-server.ui.v1', value);
  expect((await preferences()).getState()).toMatchObject({
    theme: 'light',
    sidebarCollapsed: false,
    sidebarWidth: 240,
    fileWidth: 420,
  });
});
it('读写存储均失败时主题、折叠和宽度仍在内存可用', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('存储不可用');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('存储不可用');
  });
  const store = await preferences();
  expect(() => {
    store.getState().toggleTheme();
    store.getState().setSidebarCollapsed(true);
    store.getState().setWidth('fileWidth', 400);
  }).not.toThrow();
  expect(store.getState()).toMatchObject({ theme: 'dark', sidebarCollapsed: true, fileWidth: 400 });
});

it('停靠新增尺寸不会丢弃已有主题，宽窄模式分别有界恢复', async () => {
  localStorage.setItem(
    'ssh-server.ui.v1',
    JSON.stringify({
      version: 1,
      theme: 'dark',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      fileWidth: 480,
      resourceWidth: 300,
      rightWidth: 500,
      wideToolsWidth: 900,
      resourceShare: 35,
      resourceHeight: 45,
    }),
  );
  const store = await preferences();
  expect(store.getState()).toMatchObject({
    theme: 'dark',
    sidebarWidth: 280,
    fileWidth: 480,
    resourceWidth: 300,
    rightWidth: 500,
    wideToolsWidth: 900,
    resourceShare: 35,
    resourceHeight: 45,
  });
  store.getState().setWidth('rightWidth', 0);
  store.getState().setWidth('resourceWidth', 99999);
  expect((await preferences()).getState()).toMatchObject({ rightWidth: 500, resourceWidth: 300 });
});
it('旧偏好缺少停靠字段时补默认值，窄屏自动折叠不写入用户偏好', async () => {
  localStorage.setItem(
    'ssh-server.ui.v1',
    JSON.stringify({
      version: 1,
      theme: 'dark',
      sidebarCollapsed: false,
      sidebarWidth: 280,
      fileWidth: 480,
    }),
  );
  const store = await preferences();
  expect(store.getState()).toMatchObject({ theme: 'dark', rightWidth: 420, resourceWidth: 320 });
  store.getState().setSidebarAutoCollapsed(true);
  expect((await preferences()).getState().sidebarCollapsed).toBe(false);
});
