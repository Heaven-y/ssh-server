import { useCallback, useEffect, useState } from 'react';

function blockedShortcut(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat;
}
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (blockedShortcut(event)) return false;
  if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
    return false;
  if (event.target instanceof Element && event.target.closest('.xterm')) return false;
  // show()与showModal()都设置open；只有:modal表示原生模态，不能按ARIA角色猜测。
  return !document.querySelector('dialog:modal');
}
export function useCommandPalette() {
  const [opened, setOpened] = useState(false);
  const open = useCallback(() => {
    if (!document.querySelector('dialog:modal')) setOpened(true);
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
