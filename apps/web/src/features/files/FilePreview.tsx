import { CircleAlert, RefreshCw } from 'lucide-react';
import { CodeEditor, type CodeFormat } from '../../ui/CodeEditor';
import { buttonClass } from '../../ui/styles';
import type { useFilePreview } from './use-file-preview';

const FORMATS: Record<string, CodeFormat> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'shell',
  bash: 'shell',
  slurm: 'shell',
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
};
const noop = () => undefined;
function formatOf(file: string): CodeFormat {
  return FORMATS[file.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'text';
}

/** 只读文件预览：可查看正文与语言，不提供写入入口；改动请在外部编辑器或由 Agent 完成。 */
export function FilePreview({ preview, disabled }: { preview: ReturnType<typeof useFilePreview>; disabled: boolean }) {
  const file = preview.file;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {file ? (
        <>
          <div className="flex shrink-0 items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
              {file.path}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">只读 · {formatOf(file.path)}</span>
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={disabled}
              aria-label="重新读取文件"
              title="重新读取文件"
              onClick={() => {
                void preview.open(file.path);
              }}
            >
              <RefreshCw aria-hidden className="size-4" />
            </button>
          </div>
          {preview.busy && (
            <p role="status" className="px-3 pb-2 text-xs">
              正在读取文件…
            </p>
          )}
          {preview.error && (
            <p role="alert" className="flex gap-2 border-y border-border p-3 text-xs text-destructive-foreground">
              <CircleAlert aria-hidden className="size-4 shrink-0" />
              {preview.error}
            </p>
          )}
          <div className="min-h-56 flex-1">
            <CodeEditor
              key={file.path}
              value={file.content}
              format={formatOf(file.path)}
              label="项目文件内容"
              height="100%"
              disabled
              lineSeparator={file.content.includes('\r\n') ? '\r\n' : '\n'}
              onChange={noop}
            />
          </div>
        </>
      ) : (
        <p className="m-auto max-w-xs p-6 text-sm leading-6 text-muted-foreground">
          选择本地脚本或配置文件查看内容。文件列表沿用同步范围，只读打开不超过 2 MiB 的 UTF-8
          文本；修改请在外部编辑器里进行，或让 Agent 直接改文件。
        </p>
      )}
    </div>
  );
}
