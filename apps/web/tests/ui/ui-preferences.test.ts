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
  store.getState().toggleTheme();
  store.getState().setWidth('sidebarWidth', 280);
  store.getState().setWidth('fileWidth', 480);
  store.getState().setSidebarCollapsed(true);
  store.getState().setWidth('sidebarWidth', 0);
  store.getState().setWidth('fileWidth', Infinity);
  const restored = await preferences();
  expect(restored.getState()).toMatchObject({
    theme: 'light',
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
    theme: 'dark',
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
  expect(store.getState()).toMatchObject({ theme: 'light', sidebarCollapsed: true, fileWidth: 400 });
});
