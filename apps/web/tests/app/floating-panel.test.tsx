// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspacePanelFrame } from '../../src/app/WorkspacePanelFrame';
import { useUiPreferences } from '../../src/ui/ui-preferences';

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  useUiPreferences.setState({ fileWidth: 420 });
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  Reflect.deleteProperty(HTMLElement.prototype, 'releasePointerCapture');
});
function mount(kind: 'resources' | 'files' = 'resources') {
  function Example() {
    const [opened, setOpened] = useState(true);
    return (
      <>
        <button onClick={() => setOpened(true)}>重新打开</button>
        <WorkspacePanelFrame kind={kind} opened={opened} front onActivate={() => {}} hide={() => setOpened(false)}>
          <input aria-label="保留内容" defaultValue="原始内容" />
        </WorkspacePanelFrame>
      </>
    );
  }
  render(<Example />);
  return screen.getByRole('complementary', { name: kind === 'files' ? '文件面板' : '资源面板' });
}
function rect(panel: HTMLElement) {
  return Object.fromEntries(
    ['left', 'top', 'width', 'height'].map((name) => [name, parseFloat(panel.style.getPropertyValue(name))]),
  ) as Record<'left' | 'top' | 'width' | 'height', number>;
}
function drag(handle: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 4000, clientY: 4000 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 + x, clientY: 10 + y });
  fireEvent.pointerUp(handle, { pointerId: 1 });
}
it('标题可拖动且不能移出视口，其他指针不会接管当前拖动', () => {
  const panel = mount();
  const handle = screen.getByRole('button', { name: '移动资源面板' });
  const initial = rect(panel);
  drag(handle, -120, 40);
  expect(rect(panel)).toEqual({ ...initial, left: initial.left - 120, top: initial.top + 40 });
  drag(handle, -4000, -4000);
  expect(rect(panel).left).toBe(12);
  expect(rect(panel).top).toBe(72);
});
it('方向键微调，Shift加速；只有操作柄处理箭头，正文仍可输入', () => {
  const panel = mount();
  const handle = screen.getByRole('button', { name: '移动资源面板' });
  const initial = rect(panel);
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
  expect(rect(panel)).toEqual({ ...initial, left: initial.left - 10, top: initial.top + 40 });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowLeft' });
  expect(rect(panel).left).toBe(initial.left - 10);
});
it('右下角可缩放，文件宽度记忆与资源尺寸互不混用', () => {
  const panel = mount('files');
  const initial = rect(panel);
  const handle = screen.getByRole('button', { name: '调整文件面板大小' });
  drag(handle, 180, 20);
  expect(rect(panel)).toEqual({ ...initial, width: 600, height: initial.height + 20 });
  expect(useUiPreferences.getState().fileWidth).toBe(600);
  fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
  expect(rect(panel).width).toBe(640);
  expect(useUiPreferences.getState().fileWidth).toBe(640);
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(rect(panel).height).toBe(initial.height + 10);
});
it('窗口变小自动约束位置与大小，复位后标题和缩放柄均可达', () => {
  const panel = mount();
  drag(screen.getByRole('button', { name: '调整资源面板大小' }), 4000, 4000);
  expect(useUiPreferences.getState().fileWidth).toBe(420);
  act(() => {
    vi.stubGlobal('innerWidth', 960);
    vi.stubGlobal('innerHeight', 640);
    window.dispatchEvent(new Event('resize'));
  });
  const changed = rect(panel);
  expect(changed.left).toBeGreaterThanOrEqual(12);
  expect(changed.top).toBeGreaterThanOrEqual(72);
  expect(changed.left + changed.width).toBeLessThanOrEqual(948);
  expect(changed.top + changed.height).toBeLessThanOrEqual(628);
  fireEvent.click(screen.getByRole('button', { name: '复位资源面板' }));
  expect(rect(panel).width).toBe(420);
  expect(rect(panel).left).toBe(528);
});
it('收起保留输入子树和面板几何信息，重新打开不重置', () => {
  const panel = mount();
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '保留内容' });
  fireEvent.change(input, { target: { value: '未保存内容' } });
  drag(screen.getByRole('button', { name: '移动资源面板' }), -90, 20);
  const moved = rect(panel);
  fireEvent.click(screen.getByRole('button', { name: '收起资源面板' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.value).toBe('未保存内容');
  expect(rect(panel)).toEqual(moved);
});
