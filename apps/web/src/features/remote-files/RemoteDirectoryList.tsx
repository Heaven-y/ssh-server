import { useState } from 'react';
import { File, Folder, Link, Shapes, X } from 'lucide-react';
import type { RemoteDirectory, RemoteFileEntry, RemoteFileScope } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';

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
}: {
  directory: RemoteDirectory;
  showHidden: boolean;
  loading: boolean;
  navigate(path: string): void;
}) {
  const [selectedPath, setSelectedPath] = useState<string>();
  const entries = showHidden ? directory.entries : directory.entries.filter((entry) => !entry.name.startsWith('.'));
  const selected = entries.find((entry) => entry.path === selectedPath);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2" aria-busy={loading}>
        <ul aria-label="服务器目录条目" className="space-y-1">
          {entries.map((entry) => (
            <RemoteEntryRow
              key={entry.path}
              entry={entry}
              selected={selected?.path === entry.path}
              loading={loading}
              onClick={() => (entry.type === 'directory' ? navigate(entry.path) : setSelectedPath(entry.path))}
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
      {selected && <EntryDetails entry={selected} close={() => setSelectedPath(undefined)} />}
    </div>
  );
}

function RemoteEntryRow({
  entry,
  selected,
  loading,
  onClick,
}: {
  entry: RemoteFileEntry;
  selected: boolean;
  loading: boolean;
  onClick(): void;
}) {
  const Icon = TYPE_ICONS[entry.type];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-pressed={entry.type === 'directory' ? undefined : selected}
        className={`flex w-full min-w-0 gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted disabled:opacity-50 ${selected ? 'bg-muted' : ''}`}
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm" title={entry.name}>
            <bdi>{entry.name}</bdi>
          </span>
          <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{TYPE_LABELS[entry.type]}</span>
            <span>{SCOPE_LABELS[entry.scope]}</span>
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {entry.type === 'file' && <span>{sizeLabel(entry)}</span>}
            <span>{modifiedLabel(entry.modifiedAt)}</span>
          </span>
        </span>
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
