import { useCallback, useEffect, useState } from 'react';

function blockedShortcut(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat;
}
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (blockedShortcut(event)) return false;
  if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
    return false;
  if (event.target instanceof Element && event.target.closest('.xterm')) return false;
  // 宽窗文件是非模态complementary，可从其中打开；窄窗与其他原生modal保持自己的键盘范围。
  return !document.querySelector('dialog[open]:not([role="complementary"])');
}
export function useCommandPalette() {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => {
    if (!document.querySelector('dialog[open]:not([role="complementary"])')) setOpened(true);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpened(true);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  return { opened, open, close: () => setOpened(false) };
}
