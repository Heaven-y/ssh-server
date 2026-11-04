// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../../src/app/WorkspaceLayout';
import { dockSizing } from '../../src/app/WorkspaceColumns';
import { ServerDock, type ServerDockView } from '../../src/app/ServerDock';
import { AppearanceActions } from '../../src/app/TopBar';
import { useUiPreferences } from '../../src/ui/ui-preferences';

let width = 1920;
let changed: Set<() => void>;
beforeEach(() => {
  width = 1920;
  changed = new Set();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return width >= Number(query.match(/\d+/)?.[0] ?? Infinity);
    },
    addEventListener: (_: string, callback: () => void) => changed.add(callback),
    removeEventListener: (_: string, callback: () => void) => changed.delete(callback),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useUiPreferences.setState({
    sidebarCollapsed: false,
    sidebarAutoCollapsed: false,
    sidebarWidth: 240,
    rightWidth: 420,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function resize(next: number) {
  act(() => {
    width = next;
    changed.forEach((callback) => callback());
  });
}
function Example() {
  const [dockOpen, setDock] = useState(true);
  const [view, setView] = useState<ServerDockView>('resources');
  const [loaded, setLoaded] = useState<ReadonlySet<ServerDockView>>(() => new Set<ServerDockView>(['resources']));
  const select = (next: ServerDockView) => {
    setLoaded((previous) => (previous.has(next) ? previous : new Set(previous).add(next)));
    setView(next);
  };
  return (
    <>
      <AppearanceActions />
      <button onClick={() => setDock(!dockOpen)}>切换服务器面板</button>
      <WorkspaceLayout
        dockOpen={dockOpen}
        navigation={<nav aria-label="项目与会话">项目</nav>}
        dock={
          <ServerDock open={dockOpen} view={view} loaded={loaded} onSelectView={select} onHide={() => setDock(false)} />
        }
      >
        <main>
          <input aria-label="对话内容" defaultValue="对话" />
        </main>
      </WorkspaceLayout>
    </>
  );
}

it('宽屏同时停靠左栏、对话与服务器面板，分隔线具有明确键盘入口', () => {
  render(<Example />);
  expect(screen.getByRole('textbox', { name: '对话内容' })).toBeTruthy();
  const dock = screen.getByRole('complementary', { name: '服务器面板' });
  expect(within(dock).getByRole('tab', { name: '资源' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('separator', { name: '调整侧栏宽度' })).toBeTruthy();
  const separator = screen.getByRole('separator', { name: '调整服务器面板宽度' });
  expect(separator.getAttribute('aria-orientation')).toBe('vertical');
  expect(separator.tabIndex).toBe(0);
});

it('收起服务器面板只隐藏，不重建对话节点；重新展开仍是同一节点', () => {
  render(<Example />);
  const chat = screen.getByRole('textbox', { name: '对话内容' });
  fireEvent.change(chat, { target: { value: '未发送草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '收起服务器面板' }));
  // 收起后面板整体 hidden，不在可访问树里；用容器断言，避免依赖查询实现。
  expect(document.getElementById('server-dock')!.closest('[hidden]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换服务器面板' }));
  expect(screen.getByRole('textbox', { name: '对话内容' })).toBe(chat);
  expect((chat as HTMLInputElement).value).toBe('未发送草稿');
});

it('960px 自动收起项目侧栏但允许主动展开，回到宽屏不覆写用户原偏好', () => {
  render(<Example />);
  resize(960);
  expect(screen.queryByRole('navigation', { name: '项目与会话' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBeTruthy();
  resize(1920);
  expect(screen.getByRole('navigation', { name: '项目与会话' })).toBeTruthy();
  expect(useUiPreferences.getState().sidebarCollapsed).toBe(false);
});

it('服务器面板是同一停靠区的互斥视图，切换不叠盖也不重建对话', () => {
  render(<Example />);
  const chat = screen.getByRole('textbox', { name: '对话内容' });
  const dock = screen.getByRole('complementary', { name: '服务器面板' });
  fireEvent.click(within(dock).getByRole('tab', { name: '文件' }));
  expect(dock.getAttribute('data-view')).toBe('files');
  const files = dock.querySelector('[aria-label="文件视图"]') as HTMLElement;
  const resources = dock.querySelector('[aria-label="资源视图"]') as HTMLElement;
  expect(files.hidden).toBe(false);
  expect(resources.hidden).toBe(true);
  expect(screen.getByRole('textbox', { name: '对话内容' })).toBe(chat);
});

it('右侧面板只有一条宽度约束，收起时不占宽度', () => {
  expect(dockSizing()).toEqual({ key: 'rightWidth', min: 360, max: 720 });
});
