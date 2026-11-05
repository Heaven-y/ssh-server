import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import type { NativeResource, NativeResourceDocument } from '@agentdeck/shared';
import { api, type NativeResourceContext } from '../../lib/api';
import { CodeEditor } from '../../ui/CodeEditor';
import { buttonClass } from '../../ui/styles';
import { SettingsDetailDialog } from './SettingsDetailDialog';
import { NativeConfigHelp } from './NativeConfigHelp';
import { confirmNativeDiscard, nativeSettingsError } from './native-resource-labels';
import { invalidateNativeCapabilities } from './model-settings-api';

function ConfigHelp({
  document,
  content,
  disabled,
  insert,
}: {
  document: NativeResourceDocument;
  content: string;
  disabled: boolean;
  insert(value: string): void;
}) {
  const { resource } = document;
  if (resource.kind !== 'settings' || resource.agent === 'antigravity') return null;
  if (resource.format !== 'json' && resource.format !== 'toml') return null;
  return (
    <NativeConfigHelp
      agent={resource.agent}
      document={{
        ...document,
        agent: resource.agent,
        displayPath: resource.displayPath,
        format: resource.format,
        exists: resource.exists,
      }}
      content={content}
      disabled={disabled}
      onInsert={insert}
    />
  );
}

type EditorProps = {
  context: NativeResourceContext;
  resource: NativeResource;
  onClose(): void;
  onBack(): void;
};
function useNativeResourceEditor({ context, resource }: Pick<EditorProps, 'context' | 'resource'>) {
  const { agent, projectId } = context;
  const [document, setDocument] = useState<NativeResourceDocument>();
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const lock = useRef(false);
  const dirty = !!document && document.content !== content;
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void api
      .openNativeResource({ agent, projectId }, resource.id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDocument(result);
        setContent(result.content);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(nativeSettingsError(reason));
        setLoading(false);
      });
    return () => pending.current?.abort();
  }, [agent, projectId, resource.id, reload]);
  const clear = () => {
    pending.current?.abort();
    setDocument(undefined);
    setContent('');
    setError('');
    setMessage('');
  };
  const leave = (action: () => void) => {
    if (lock.current || !confirmNativeDiscard(dirty)) return;
    clear();
    action();
  };
  const reread = () =>
    leave(() => {
      setLoading(true);
      setReload((value) => value + 1);
    });
  const edit = (value: string) => {
    setContent(value);
    setMessage('');
  };
  const save = async () => {
    if (!document || !document.resource.editable || lock.current || loading) return;
    lock.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    pending.current = controller;
    try {
      const saved = await api.saveNativeResource(
        context,
        resource.id,
        { content, revision: document.revision },
        controller.signal,
      );
      await invalidateNativeCapabilities(agent);
      if (controller.signal.aborted) return;
      setDocument({ ...saved, content });
      setMessage('文件已保存。后续生效方式以该 CLI 为准；已有运行时可在启动环境中重新启动。');
    } catch (reason) {
      if (!controller.signal.aborted) setError(nativeSettingsError(reason));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  const editable = document?.resource.editable ?? false;
  return { document, content, error, message, loading, saving, dirty, editable, leave, reread, edit, save };
}
type EditorState = ReturnType<typeof useNativeResourceEditor>;

/** 只有显式打开此视图才请求正文；敏感正文与撤销历史仅随编辑器存活。 */
export default function NativeResourceEditor({ context, resource, onClose, onBack }: EditorProps) {
  const state = useNativeResourceEditor({ context, resource });
  return (
    <SettingsDetailDialog
      title={resource.label}
      backLabel="返回资源目录"
      busy={state.saving}
      onBack={() => state.leave(onBack)}
      onClose={() => state.leave(onClose)}
      footer={<EditorFooter state={state} />}
    >
      <EditorContent state={state} resource={resource} />
    </SettingsDetailDialog>
  );
}

function EditorFooter({ state }: { state: EditorState }) {
  const { dirty, saving, loading, editable, save } = state;
  return (
    <>
      <p className="text-xs text-muted-foreground">{dirty ? '有未保存修改' : '完整原生文件 · 关闭后清除编辑内容'}</p>
      <button
        type="button"
        className={buttonClass('primary')}
        disabled={saving || loading || !editable || !dirty}
        onClick={() => void save()}
      >
        <Save aria-hidden className="size-4" />
        {saving ? '正在保存…' : '保存文件'}
      </button>
    </>
  );
}

function EditorContent({ state, resource }: { state: EditorState; resource: NativeResource }) {
  const { loading, saving, document, content, error, message, reread, edit, editable } = state;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">{resource.displayPath}</p>
        <button type="button" className={buttonClass('outline')} disabled={saving || loading} onClick={reread}>
          <RefreshCw aria-hidden className="size-4" />
          重新读取文件
        </button>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{resource.description}</p>
      {loading && (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          正在读取文件…
        </p>
      )}
      {document && (
        <>
          {!document.resource.exists && (
            <p className="text-sm text-muted-foreground">文件尚未创建，明确保存后才会写入。</p>
          )}
          <ConfigHelp document={document} content={content} disabled={saving || !editable} insert={edit} />
          <div className="min-w-0 overflow-hidden rounded-md border border-border-strong">
            <CodeEditor
              value={content}
              format={document.resource.format}
              disabled={saving || !editable}
              lineSeparator={document.content.includes('\r\n') ? '\r\n' : '\n'}
              label="原生文件内容"
              onChange={edit}
            />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </>
  );
}
