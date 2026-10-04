import { Folder, CornerLeftUp } from 'lucide-react';
import { buttonClass } from '../../../ui/styles';

type Entry = { name: string; path: string; type: 'directory' | 'file' | 'link' | 'other' };
export function DirectoryPicker(props: {
  path: string;
  parent: string;
  entries: Entry[];
  roots?: string[];
  nextCursor?: string;
  busy: boolean;
  browse(path: string, cursor?: string): void;
  choose(path: string): void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={props.busy || props.parent === props.path}
          onClick={() => props.browse(props.parent)}
        >
          <CornerLeftUp aria-hidden className="size-4" />
          上一级
        </button>
        {props.roots?.map((root) => (
          <button
            key={root}
            type="button"
            className={buttonClass('ghost')}
            disabled={props.busy}
            onClick={() => props.browse(root)}
          >
            {root}
          </button>
        ))}
      </div>
      <p className="font-mono text-xs leading-5 wrap-anywhere">{props.path}</p>
      <ul aria-label="目录内容" className="max-h-64 overflow-auto rounded border border-border divide-y divide-border">
        {props.entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:text-muted-foreground"
              disabled={props.busy || entry.type !== 'directory'}
              onClick={() => props.browse(entry.path)}
            >
              {entry.type === 'directory' && <Folder aria-hidden className="size-4 shrink-0" />}
              <span className="min-w-0 wrap-anywhere">{entry.name}</span>
              <span className="ml-auto shrink-0 text-xs">
                {entry.type === 'link'
                  ? '符号链接'
                  : entry.type === 'file'
                    ? '文件'
                    : entry.type === 'other'
                      ? '其他'
                      : ''}
              </span>
            </button>
          </li>
        ))}
        {!props.entries.length && <li className="p-3 text-sm text-muted-foreground">此页没有目录项</li>}
      </ul>
      <div className="flex flex-wrap justify-between gap-2">
        {props.nextCursor && (
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={props.busy}
            onClick={() => props.browse(props.path, props.nextCursor)}
          >
            加载下一页
          </button>
        )}
        <button
          type="button"
          className={`${buttonClass('primary')} ml-auto`}
          disabled={props.busy}
          onClick={() => props.choose(props.path)}
        >
          使用此目录
        </button>
      </div>
    </div>
  );
}
