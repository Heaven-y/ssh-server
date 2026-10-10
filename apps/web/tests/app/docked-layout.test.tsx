// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../../src/app/WorkspaceLayout';
import { toolSizing } from '../../src/app/WorkspaceColumns';
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
    fileWidth: 420,
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
  const [resourcesOpen, setResources] = useState(true);
  const [filesOpen, setFiles] = useState(true);
  return (
    <>
      <AppearanceActions />
      <button onClick={() => setResources(!resourcesOpen)}>切换资源</button>
      <button onClick={() => setFiles(!filesOpen)}>切换文件</button>
      <WorkspaceLayout
        navigation={<nav aria-label="工作区列表">项目</nav>}
        resources={<input aria-label="资源内容" defaultValue="资源" />}
        files={<input aria-label="文件内容" defaultValue="文件" />}
        resourcesOpen={resourcesOpen}
        filesOpen={filesOpen}
      >
        <main>
          <input aria-label="对话内容" defaultValue="对话" />
        </main>
      </WorkspaceLayout>
    </>
  );
}
it('宽屏同时停靠工作区、对话、资源与文件，分隔线具有明确键盘入口', () => {
  render(<Example />);
  expect(screen.getByRole('textbox', { name: '资源内容' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: '文件内容' })).toBeTruthy();
  const separator = screen.getByRole('separator', { name: '调整资源与文件宽度' });
  expect(separator.getAttribute('aria-orientation')).toBe('vertical');
  expect(separator.tabIndex).toBe(0);
  expect(screen.getByRole('separator', { name: '调整工具区宽度' })).toBeTruthy();
});
it('较窄窗口只把资源和文件改为上下分屏，不重建对话或文件节点', () => {
  render(<Example />);
  const file = screen.getByRole<HTMLInputElement>('textbox', { name: '文件内容' });
  const chat = screen.getByRole('textbox', { name: '对话内容' });
  fireEvent.change(file, { target: { value: '未保存文件' } });
  resize(1280);
  expect(screen.getByRole('separator', { name: '调整资源与文件高度' }).getAttribute('aria-orientation')).toBe(
    'horizontal',
  );
  expect(screen.getByRole('textbox', { name: '文件内容' })).toBe(file);
  expect(file.value).toBe('未保存文件');
  resize(1920);
  expect(screen.getByRole('textbox', { name: '对话内容' })).toBe(chat);
  expect(screen.getByRole('textbox', { name: '文件内容' })).toBe(file);
});
it('960px自动收起工作区栏但允许主动展开，回到宽屏不覆写用户原偏好', () => {
  render(<Example />);
  resize(960);
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.getByRole('textbox', { name: '文件内容' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
  expect(screen.getByRole('navigation')).toBeTruthy();
  resize(1920);
  expect(screen.getByRole('navigation')).toBeTruthy();
});
it('收起任意工具不关闭另一工具，两个都收起后再开仍是原节点', () => {
  render(<Example />);
  const file = screen.getByRole('textbox', { name: '文件内容' });
  fireEvent.click(screen.getByRole('button', { name: '切换资源' }));
  expect(screen.queryByRole('textbox', { name: '资源内容' })).toBeNull();
  expect(screen.getByRole('textbox', { name: '文件内容' })).toBe(file);
  fireEvent.click(screen.getByRole('button', { name: '切换文件' }));
  expect(screen.queryByRole('separator', { name: '调整工具区宽度' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '切换文件' }));
  expect(screen.getByRole('textbox', { name: '文件内容' })).toBe(file);
});

it.each([
  { horizontal: false, resources: true, files: true, expected: { key: 'rightWidth', min: 360, max: 720 } },
  { horizontal: true, resources: true, files: false, expected: { key: 'resourceWidth', min: 280, max: 640 } },
  { horizontal: true, resources: false, files: true, expected: { key: 'fileWidth', min: 360, max: 960 } },
  { horizontal: true, resources: true, files: true, expected: { key: 'wideToolsWidth', min: 646, max: 1400 } },
])('停靠尺寸模式 $expected.key 同时提供最小和最大宽度约束', ({ horizontal, resources, files, expected }) => {
  expect(toolSizing(horizontal, resources, files)).toEqual(expected);
});
