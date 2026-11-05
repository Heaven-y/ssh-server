// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopTitleBar } from '../../src/app/DesktopTitleBar';
import { SidebarBrand } from '../../src/app/SidebarChrome';
import { useUiPreferences } from '../../src/ui/ui-preferences';

beforeEach(() => {
  useUiPreferences.setState({ theme: 'light', sidebarCollapsed: false, sidebarAutoCollapsed: false });
});
afterEach(() => {
  cleanup();
  delete window.agentDeck;
});

function bridge() {
  const chrome = { showMenu: vi.fn(async () => {}), setTheme: vi.fn(async () => {}) };
  window.agentDeck = { platform: 'win32', selectDirectory: async () => null, chrome };
  return chrome;
}

it('浏览器隐藏桌面菜单，保留侧栏品牌；桌面品牌只出现在同一顶栏', () => {
  const view = render(
    <>
      <DesktopTitleBar />
      <SidebarBrand collapsed={false} />
    </>,
  );
  expect(screen.queryByRole('menubar')).toBeNull();
  expect(screen.getByText('AgentDeck')).toBeTruthy();
  bridge();
  view.rerender(
    <>
      <DesktopTitleBar />
      <SidebarBrand collapsed={false} />
    </>,
  );
  const brand = screen.getByText('AgentDeck');
  const menu = screen.getByRole('menubar', { name: '应用菜单' });
  expect(brand.closest('header')).toBe(menu.closest('header'));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['File', 'Edit', 'View', 'Window']);
  fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
  expect(useUiPreferences.getState().sidebarCollapsed).toBe(true);
});

it('菜单点击和键盘入口调用具名能力；主题同步给系统窗口按钮', async () => {
  const chrome = bridge();
  render(<DesktopTitleBar />);
  expect(chrome.setTheme).toHaveBeenCalledWith('light');
  fireEvent.keyDown(window, { key: 'F10' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'File' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
  await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }));
  expect(chrome.showMenu).toHaveBeenCalledWith('edit', { x: 0, y: 0 });
  await act(async () => fireEvent.keyDown(window, { key: 'v', altKey: true }));
  expect(chrome.showMenu).toHaveBeenLastCalledWith('view', { x: 0, y: 0 });
  act(() => useUiPreferences.setState({ theme: 'dark' }));
  expect(chrome.setTheme).toHaveBeenLastCalledWith('dark');
});

it('原生菜单打开中不重入，失败后恢复并显示可重试反馈', async () => {
  const chrome = bridge();
  let fail!: (error: Error) => void;
  chrome.showMenu.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(<DesktopTitleBar />);
  fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(chrome.showMenu).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('internal')));
  expect(screen.getByRole('alert').textContent).toBe('应用菜单未能打开，请重试。');
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'View' })));
  expect(chrome.showMenu).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
