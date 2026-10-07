import { useState } from 'react';
import { Menu, MenuItem, useMenuStore } from '@ariakit/react';
import { FileCode2, Folder } from 'lucide-react';
import type { WorkspaceDirectory } from '@ssh-server/shared';
import { navigateFileList } from '../../ui/file-list-navigation';
import { buttonClass } from '../../ui/styles';

type Entry = WorkspaceDirectory['entries'][number];
export function LocalDirectoryEntries({
  entries,
  disabled,
  open,
}: {
  entries: Entry[];
  disabled: boolean;
  open(entry: Entry): void;
}) {
  const [selected, select] = useState<string>();
  const [menuEntry, setMenuEntry] = useState<Entry>();
  const menu = useMenuStore({ placement: 'bottom-start' });
  function showMenu(entry: Entry, anchor: HTMLElement) {
    if (disabled) return;
    select(entry.path);
    setMenuEntry(entry);
    menu.setAnchorElement(anchor);
    menu.show();
  }
  return (
    <>
      <ul aria-label="本地目录条目" className="max-h-56 overflow-auto px-2 pb-2">
        {entries.map((entry) => {
          const Icon = entry.kind === 'directory' ? Folder : FileCode2;
          return (
            <li key={entry.path}>
              <button
                type="button"
                data-file-entry
                aria-label={entry.name}
                aria-pressed={selected === entry.path}
                disabled={disabled}
                onFocus={() => select(entry.path)}
                onClick={() => select(entry.path)}
                onDoubleClick={() => open(entry)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  showMenu(entry, event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (navigateFileList(event)) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    open(entry);
                  }
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    showMenu(entry, event.currentTarget);
                  }
                }}
                className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50 ${selected === entry.path ? 'bg-accent/10' : ''}`}
              >
                <Icon
                  aria-hidden
                  className={`size-4 shrink-0 ${entry.kind === 'directory' ? 'text-accent' : 'text-muted-foreground'}`}
                />
                <span className="min-w-0 flex-1 truncate" title={entry.name}>
                  {entry.name}
                </span>
                {entry.size !== undefined && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {Math.ceil(entry.size / 1024)} KiB
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Menu
        store={menu}
        aria-label="本地文件菜单"
        gutter={4}
        className="z-50 min-w-36 rounded-lg border border-border bg-card p-1 text-sm text-foreground shadow-xl"
        unmountOnHide
      >
        <MenuItem
          disabled={disabled || !menuEntry}
          className={`${buttonClass('ghost')} w-full justify-start`}
          onClick={() => {
            menu.hide();
            if (menuEntry && !disabled) open(menuEntry);
          }}
        >
          {menuEntry?.kind === 'directory' ? '打开文件夹' : '打开文件'}
        </MenuItem>
      </Menu>
    </>
  );
}
