import type { KeyboardEvent } from 'react';

/** 列表内移动焦点，不拦截输入框或菜单的按键。 */
export function navigateFileList(event: KeyboardEvent): boolean {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return false;
  const rows = Array.from(
    event.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('button[data-file-entry]:not(:disabled)') ??
      [],
  );
  const index = rows.indexOf(event.currentTarget as HTMLButtonElement);
  if (index < 0) return false;
  const next =
    event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
  event.preventDefault();
  event.stopPropagation();
  rows[Math.max(0, Math.min(next, rows.length - 1))]?.focus();
  return true;
}

export function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}
