import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Menu, MenuItem, useMenuStore } from '@ariakit/react';
import { Ellipsis, File, Folder, Link, Shapes, X } from 'lucide-react';
import type {
  RemoteDirectory,
  RemoteFileActionInput,
  RemoteFileActionKind,
  RemoteFileEntry,
  RemoteFileScope,
} from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { ACTION_LABELS } from './RemoteActionDialog';
import { isContextMenuKey, navigateFileList } from '../../ui/file-list-navigation';

const TYPE_LABELS = { file: '文件', directory: '目录', link: '符号链接', other: '其他类型' };
const TYPE_ICONS = { file: File, directory: Folder, link: Link, other: Shapes };
const SCOPE_LABELS: Record<RemoteFileScope, string> = {
  included: '在同步范围内',
  excluded: '不在同步范围内',
  outside: '工作区外',
  directory: '可能包含同步文件',
  link: '链接不参与同步',
  unsupported: '本地无法表示此名称',
};
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function modifiedLabel(value: number | undefined) {
  if (value === undefined || !Number.isFinite(new Date(value).getTime())) return '修改时间未知';
  return dateFormat.format(value);
}

function sizeLabel(entry: RemoteFileEntry) {
  if (entry.type !== 'file' || entry.size === undefined) return '—';
  if (entry.size < 1024) return `${entry.size} B`;
  if (entry.size < 1024 ** 2) return `${(entry.size / 1024).toFixed(1)} KiB`;
  if (entry.size < 1024 ** 3) return `${(entry.size / 1024 ** 2).toFixed(1)} MiB`;
  return `${(entry.size / 1024 ** 3).toFixed(1)} GiB`;
}

export function RemoteDirectoryList({
  directory,
  showHidden,
  loading,
  navigate,
  selectedPath,
  select,
  action,
  download,
  sessionId,
}: {
  directory: RemoteDirectory;
  showHidden: boolean;
  loading: boolean;
  navigate(path: string): void;
  selectedPath?: string;
  select(path?: string): void;
  action(input: RemoteFileActionInput): void;
  download(entry: RemoteFileEntry): void;
  sessionId: string;
}) {
  const menu = useMenuStore({ placement: 'bottom-start' });
  const [menuEntry, setMenuEntry] = useState<RemoteFileEntry>();
  const [dropPath, setDropPath] = useState<string>();
  const [detailsPath, setDetailsPath] = useState<string>();
  const entries = showHidden ? directory.entries : directory.entries.filter((entry) => !entry.name.startsWith('.'));
  const selected = entries.find((entry) => entry.path === selectedPath);
  const request = (kind: RemoteFileActionKind, entry = selected) => {
    if (kind === 'mkdir') action({ kind, destination: `${directory.path.replace(/\/$/, '')}/` });
    else if (entry && entry.type !== 'other')
      action({ kind, source: entry.path, destination: kind === 'rename' ? entry.path : undefined });
  };
  const shortcut = (event: KeyboardEvent, entry?: RemoteFileEntry) => {
    if (loading) return;
    if (navigateFileList(event)) return;
    const kind = shortcutAction(event);
    if (kind) {
      event.preventDefault();
      request(kind, entry);
    }
    if (event.key === 'Enter' && entry?.type === 'directory') {
      event.preventDefault();
      navigate(entry.path);
    }
    if (entry && isContextMenuKey(event)) {
      event.preventDefault();
      openMenu(entry, event.currentTarget as HTMLElement);
    }
  };
  function openMenu(entry: RemoteFileEntry | undefined, anchor: HTMLElement) {
    select(entry?.path);
    setMenuEntry(entry);
    menu.setAnchorElement(anchor);
    menu.show();
  }
  const dropped = (event: DragEvent, target: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropPath(undefined);
    if (loading) return;
    try {
      const data = JSON.parse(event.dataTransfer.getData('application/x-ssh-server-remote-file')) as {
        sessionId?: unknown;
        path?: unknown;
      };
      if (data.sessionId !== sessionId || typeof data.path !== 'string') return;
      action({
        kind: event.altKey ? 'copy' : 'move',
        source: data.path,
        destination: `${target.replace(/\/$/, '')}/${data.path.split('/').at(-1)}`,
      });
    } catch {
      /* 外部拖放不提交服务器操作。 */
    }
  };
  return (
    <div className="flex min-h-32 min-w-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-auto px-2 py-2"
        aria-busy={loading}
        onContextMenu={(event) => {
          if (event.target instanceof Element && event.target.closest('button')) return;
          event.preventDefault();
          if (!loading) openMenu(undefined, event.currentTarget);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-ssh-server-remote-file')) event.preventDefault();
        }}
        onDrop={(event) => dropped(event, directory.path)}
      >
        <ul aria-label="服务器目录条目" className="space-y-0.5">
          {entries.map((entry) => (
            <RemoteEntryRow
              key={entry.path}
              entry={entry}
              selected={selected?.path === entry.path}
              loading={loading}
              onClick={() => select(entry.path)}
              open={() => {
                if (entry.type === 'directory') navigate(entry.path);
              }}
              shortcut={(event) => shortcut(event, entry)}
              menu={(anchor) => openMenu(entry, anchor)}
              drag={(event) => {
                event.dataTransfer.setData(
                  'application/x-ssh-server-remote-file',
                  JSON.stringify({ sessionId, path: entry.path }),
                );
                event.dataTransfer.effectAllowed = 'copyMove';
              }}
              drop={entry.type === 'directory' ? (event) => dropped(event, entry.path) : undefined}
              draggedOver={dropPath === entry.path}
              dragOver={(event) => {
                if (
                  entry.type === 'directory' &&
                  event.dataTransfer.types.includes('application/x-ssh-server-remote-file')
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  setDropPath(entry.path);
                }
              }}
              dragLeave={() => setDropPath(undefined)}
            />
          ))}
        </ul>
        {entries.length === 0 && (
          <p className="p-4 text-sm leading-6 text-muted-foreground">
            {directory.entries.length ? '本页只有隐藏项，可开启“显示隐藏项”查看。' : '本页没有目录条目。'}
            {directory.nextCursor ? '可继续读取下一页。' : ''}
          </p>
        )}
      </div>
      {selected && selected.path === detailsPath && (
        <EntryDetails entry={selected} close={() => setDetailsPath(undefined)} />
      )}
      <Menu
        store={menu}
        aria-label="服务器文件菜单"
        gutter={4}
        className="z-50 min-w-40 rounded-lg border border-border bg-card p-1 text-sm text-foreground shadow-xl"
        unmountOnHide
      >
        <RemoteMenuItems
          entry={menuEntry}
          loading={loading}
          request={request}
          navigate={navigate}
          download={download}
          details={setDetailsPath}
          hide={() => menu.hide()}
        />
      </Menu>
    </div>
  );
}

function RemoteMenuItems({
  entry,
  loading,
  request,
  navigate,
  download,
  details,
  hide,
}: {
  entry?: RemoteFileEntry;
  loading: boolean;
  request(kind: RemoteFileActionKind, entry?: RemoteFileEntry): void;
  navigate(path: string): void;
  download(entry: RemoteFileEntry): void;
  details(path: string): void;
  hide(): void;
}) {
  const itemClass = `${buttonClass('ghost')} w-full justify-start`;
  if (!entry)
    return (
      <MenuItem
        disabled={loading}
        className={itemClass}
        onClick={() => {
          hide();
          request('mkdir');
        }}
      >
        新建文件夹
      </MenuItem>
    );
  return (
    <>
      {entry.type === 'directory' && (
        <MenuItem
          disabled={loading}
          className={itemClass}
          onClick={() => {
            hide();
            navigate(entry.path);
          }}
        >
          打开目录
        </MenuItem>
      )}
      {(['rename', 'move', 'copy', 'delete'] as const).map((kind) => (
        <MenuItem
          key={kind}
          disabled={loading || entry.type === 'other'}
          className={itemClass}
          onClick={() => {
            hide();
            request(kind, entry);
          }}
        >
          {ACTION_LABELS[kind]}
        </MenuItem>
      ))}
      {entry.type === 'file' && (
        <MenuItem
          disabled={loading}
          className={itemClass}
          onClick={() => {
            hide();
            download(entry);
          }}
        >
          下载…
        </MenuItem>
      )}
      <MenuItem
        className={itemClass}
        onClick={() => {
          hide();
          details(entry.path);
        }}
      >
        属性
      </MenuItem>
    </>
  );
}

function RemoteEntryRow({
  entry,
  selected,
  loading,
  onClick,
  open,
  shortcut,
  menu,
  drag,
  drop,
  draggedOver,
  dragOver,
  dragLeave,
}: {
  entry: RemoteFileEntry;
  selected: boolean;
  loading: boolean;
  onClick(): void;
  open(): void;
  shortcut(event: KeyboardEvent): void;
  menu(anchor: HTMLElement): void;
  drag(event: DragEvent): void;
  drop?: (event: DragEvent) => void;
  draggedOver: boolean;
  dragOver(event: DragEvent): void;
  dragLeave(): void;
}) {
  const Icon = TYPE_ICONS[entry.type];
  return (
    <li
      className={`group flex items-center rounded-md ${draggedOver ? 'bg-accent/10 outline outline-accent' : ''}`}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      <button
        type="button"
        data-file-entry
        aria-label={entry.name}
        title={`${TYPE_LABELS[entry.type]} · ${SCOPE_LABELS[entry.scope]}`}
        onFocus={onClick}
        onClick={onClick}
        onDoubleClick={open}
        onKeyDown={shortcut}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!loading) menu(event.currentTarget);
        }}
        draggable={!loading && entry.type !== 'other'}
        onDragStart={drag}
        disabled={loading}
        aria-pressed={selected}
        className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50 ${selected ? 'bg-accent/10' : ''}`}
      >
        <Icon
          aria-hidden
          className={`size-4 shrink-0 ${entry.type === 'directory' ? 'text-accent' : 'text-muted-foreground'}`}
        />
        <span className="min-w-0 flex-1 truncate text-sm" title={entry.name}>
          <bdi>{entry.name}</bdi>
        </span>
        {entry.type === 'file' && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{sizeLabel(entry)}</span>
        )}
      </button>
      <button
        type="button"
        className={`${buttonClass('ghost')} shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100`}
        aria-label={`${entry.name}的操作菜单`}
        disabled={loading}
        onClick={(event) => menu(event.currentTarget)}
      >
        <Ellipsis aria-hidden className="size-4" />
      </button>
    </li>
  );
}

function EntryDetails({ entry, close }: { entry: RemoteFileEntry; close(): void }) {
  return (
    <section aria-label="服务器文件元数据" className="max-h-52 shrink-0 overflow-auto border-t border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">元数据</h3>
        <button type="button" className={buttonClass('ghost')} aria-label="关闭元数据详情" onClick={close}>
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">完整路径</dt>
        <dd className="break-all font-mono" dir="ltr">
          {entry.path}
        </dd>
        <dt className="text-muted-foreground">类型</dt>
        <dd>{TYPE_LABELS[entry.type]}</dd>
        <dt className="text-muted-foreground">大小</dt>
        <dd>{sizeLabel(entry)}</dd>
        <dt className="text-muted-foreground">修改时间</dt>
        <dd>{modifiedLabel(entry.modifiedAt)}</dd>
        <dt className="text-muted-foreground">同步范围</dt>
        <dd>{SCOPE_LABELS[entry.scope]}</dd>
      </dl>
      {entry.type === 'link' && (
        <p className="mt-2 text-xs text-muted-foreground">仅显示链接自身信息，未读取或进入链接目标。</p>
      )}
    </section>
  );
}

function shortcutAction(event: KeyboardEvent): RemoteFileActionKind | undefined {
  if (event.key === 'F2') return 'rename';
  if (event.key === 'Delete') return 'delete';
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n') return 'mkdir';
  return undefined;
}
