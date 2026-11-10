// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpotlightSurface } from '../../src/ui/SpotlightSurface';
import { createPortal } from 'react-dom';

let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function move(target: Element, pointerType = 'mouse') {
  const event = new MouseEvent('pointermove', { clientX: 120, clientY: 130, bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
  frame?.(0);
}
it('仅输入框内鼠标移动显示，离开或失焦后不残留，开关关闭立即移除效果', () => {
  const mounted = render(
    <SpotlightSurface enabled>
      <textarea />
    </SpotlightSurface>,
  );
  const surface = document.querySelector<HTMLElement>('.ui-spotlight')!;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 110 } as DOMRect);
  act(() => move(document.body));
  expect(surface.dataset.illuminated).toBeUndefined();
  act(() => move(surface.querySelector('textarea')!));
  expect(surface.dataset.illuminated).toBe('true');
  expect(surface.style.getPropertyValue('--spotlight-x')).toBe('20px');
  act(() => {
    fireEvent.pointerLeave(surface);
  });
  expect(surface.dataset.illuminated).toBeUndefined();
  act(() => move(surface));
  vi.mocked(document.hasFocus).mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event('blur'));
    move(surface);
  });
  expect(surface.dataset.illuminated).toBeUndefined();
  vi.mocked(document.hasFocus).mockReturnValue(true);
  act(() => move(surface));
  mounted.rerender(
    <SpotlightSurface enabled={false}>
      <textarea />
    </SpotlightSurface>,
  );
  expect(surface.dataset.illuminated).toBeUndefined();
  act(() => move(surface));
  expect(surface.dataset.illuminated).toBeUndefined();
  expect(document.querySelector('[popover]')).toBeNull();
});
it('输入区外的 portal 菜单不会因 React 事件冒泡点亮输入框', () => {
  render(
    <SpotlightSurface enabled>
      <textarea />
      {createPortal(<button>补全菜单项</button>, document.body)}
    </SpotlightSurface>,
  );
  const surface = document.querySelector<HTMLElement>('.ui-spotlight')!;
  act(() => move(surface));
  expect(surface.dataset.illuminated).toBe('true');
  act(() => move(document.querySelector('button')!));
  expect(surface.dataset.illuminated).toBeUndefined();
});

it('触摸不显示光影，卸载取消待绘制帧', () => {
  const mounted = render(<SpotlightSurface enabled>输入区域</SpotlightSurface>);
  const surface = document.querySelector<HTMLElement>('.ui-spotlight')!;
  act(() => move(surface, 'touch'));
  expect(surface.dataset.illuminated).toBeUndefined();
  const event = new MouseEvent('pointermove', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  act(() => {
    surface.dispatchEvent(event);
  });
  expect(frame).toBeDefined();
  mounted.unmount();
  expect(frame).toBeUndefined();
});
