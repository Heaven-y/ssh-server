// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { isPaletteShortcut } from '../../src/app/use-command-palette';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function shortcut(target: HTMLElement = document.body, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, ...options });
  Object.defineProperty(event, 'target', { value: target });
  return isPaletteShortcut(event);
}
it('宽窗非模态终端和文件不阻断聊天快捷键，原生modal仍阻断', () => {
  const terminal = document.createElement('dialog');
  terminal.setAttribute('open', '');
  terminal.setAttribute('role', 'region');
  document.body.append(terminal);
  expect(shortcut()).toBe(true);
  terminal.setAttribute('role', 'complementary');
  expect(shortcut()).toBe(true);
  // jsdom不实现showModal；模拟浏览器:modal查询，实际原生门禁另有Edge验收。
  vi.spyOn(document, 'querySelector').mockReturnValue(terminal);
  expect(shortcut()).toBe(false);
});
it('保留IME、终端内部、已处理和其他组合键的原有含义', () => {
  const terminal = document.createElement('div');
  terminal.className = 'xterm';
  const input = document.createElement('textarea');
  terminal.append(input);
  document.body.append(terminal);
  expect(shortcut(input)).toBe(false);
  expect(shortcut(document.body, { isComposing: true })).toBe(false);
  expect(shortcut(document.body, { keyCode: 229 })).toBe(false);
  expect(shortcut(document.body, { shiftKey: true })).toBe(false);
  expect(shortcut(document.body, { repeat: true })).toBe(false);
  expect(shortcut(document.body, { ctrlKey: false, metaKey: true })).toBe(true);
});
