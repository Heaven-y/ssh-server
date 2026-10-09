import { CircleAlert, RefreshCw } from 'lucide-react';
import { CodeEditor, type CodeFormat } from '../../ui/CodeEditor';
import { buttonClass } from '../../ui/styles';
import type { useFileEditor } from './use-file-editor';

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
function formatOf(file: string): CodeFormat {
  return FORMATS[file.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'text';
}
export function FileEditorContent({
  editor,
  disabled,
}: {
  editor: ReturnType<typeof useFileEditor>;
  disabled: boolean;
}) {
  const file = editor.file;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {file ? (
        <>
          <div className="flex shrink-0 items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
              {file.path}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {editor.dirty ? '未保存' : '已读取'} · {formatOf(file.path)}
            </span>
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={disabled}
              aria-label="重新读取文件"
              onClick={() => {
                void editor.open(file.path);
              }}
            >
              <RefreshCw aria-hidden className="size-4" />
            </button>
          </div>
          {editor.external && (
            <p role="alert" className="flex gap-2 border-y border-border p-3 text-xs text-destructive-foreground">
              <CircleAlert aria-hidden className="size-4 shrink-0" />
              {editor.external}
            </p>
          )}
          <div className="min-h-56 flex-1">
            <CodeEditor
              key={file.path}
              value={editor.content}
              format={formatOf(file.path)}
              label="项目文件内容"
              height="100%"
              disabled={disabled}
              lineSeparator={file.content.includes('\r\n') ? '\r\n' : '\n'}
              onChange={editor.edit}
            />
          </div>
        </>
      ) : (
        <p className="m-auto max-w-xs p-6 text-sm leading-6 text-muted-foreground">
          选择本地脚本或配置文件开始编辑。文件列表沿用同步范围，编辑仅支持不超过 2 MiB 的 UTF-8 文本。
        </p>
      )}
    </div>
  );
}
