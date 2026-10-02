import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Save, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { NativeConfigAgent, NativeConfigDocument } from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';
import { CodeEditor } from '../../ui/CodeEditor';
import { buttonClass, inputClass } from '../../ui/styles';

type Phase = 'loading' | 'ready' | 'saving' | 'error';
function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : '无法访问本机配置，请检查后端后重试。';
}
function confirmDiscard(dirty: boolean) {
  return !dirty || window.confirm('配置有未保存修改，确定放弃这些修改吗？');
}

/** 配置含敏感字段，仅在显式打开期间读取，关闭和切换时清理组件内容。 */
export default function SettingsDialog({ onClose }: { onClose(): void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [agent, setAgent] = useState<NativeConfigAgent>('claude');
  const [document, setDocument] = useState<NativeConfigDocument>();
  const [content, setContent] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const dirty = document !== undefined && content !== document.content;
  const saving = phase === 'saving';
  const busy = saving || phase === 'loading';
  const edit = useCallback((value: string) => {
    setContent(value);
    setMessage('');
  }, []);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    void api
      .readAgentConfig(agent, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDocument(result);
        setContent(result.content);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(errorMessage(error));
        setPhase('error');
      });
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [agent, reload]);

  const clear = () => {
    pending.current?.abort();
    setDocument(undefined);
    setContent('');
    setMessage('');
    setPhase('loading');
  };
  const close = () => {
    if (saving || !confirmDiscard(dirty)) return;
    clear();
    onClose();
  };
  const changeAgent = (next: NativeConfigAgent) => {
    if (!confirmDiscard(dirty)) return;
    clear();
    setAgent(next);
  };
  const reread = () => {
    if (!confirmDiscard(dirty)) return;
    clear();
    setReload((value) => value + 1);
  };
  const save = async () => {
    if (!document || busy) return;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setPhase('saving');
    setMessage('');
    try {
      const result = await api.saveAgentConfig(agent, { content, revision: document.revision }, controller.signal);
      if (controller.signal.aborted) return;
      setDocument(result);
      setContent(result.content);
      setMessage('配置已保存到本机。');
      setPhase('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(errorMessage(error));
      setPhase('error');
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-40px)] overflow-hidden rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/60"
    >
      <div className="flex max-h-[calc(100vh-40px)] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={`${id}-title`} className="flex items-center gap-2 font-semibold">
            <Settings2 aria-hidden className="size-5" />
            原生 Agent 配置
          </h2>
          <button
            type="button"
            className={buttonClass('ghost')}
            aria-label="关闭设置"
            disabled={saving}
            onClick={close}
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
          <p className="text-sm leading-6 text-muted-foreground">
            编辑本机的原生配置文件，保留原有字段与注释。保存前检查语法和外部修改，配置内容不会发送给 Agent 或服务器。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor={`${id}-agent`} className="text-sm">
              Agent
            </label>
            <select
              id={`${id}-agent`}
              value={agent}
              disabled={saving}
              onChange={(event) => changeAgent(event.target.value as NativeConfigAgent)}
              className={`${inputClass} w-40!`}
            >
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={document?.displayPath}
            >
              {document?.displayPath}
            </span>
            <button type="button" className={buttonClass('outline')} disabled={busy} onClick={reread}>
              <RefreshCw aria-hidden className="size-4" />
              重新读取
            </button>
          </div>
          <div aria-busy={busy} className="min-w-0 overflow-hidden rounded-md border border-border-strong">
            {phase === 'loading' ? (
              <p
                role="status"
                className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
                正在读取本机配置…
              </p>
            ) : document ? (
              <CodeEditor
                key={agent}
                value={content}
                format={document.format}
                lineSeparator={document.content.includes('\r\n') ? '\r\n' : '\n'}
                disabled={saving}
                onChange={edit}
              />
            ) : (
              <p className="p-5 text-sm text-muted-foreground">暂时无法打开配置，请重新读取。</p>
            )}
          </div>
          <ConfigFeedback document={document} dirty={dirty} phase={phase} message={message} />
          <p className="text-xs leading-5 text-muted-foreground">
            Claude 后续调用读取新配置，正在运行的轮次保持原设置。项目或会话配置可以覆盖本机默认值。Codex
            网页对话尚未接入，保存的是其本机原生配置。
          </p>
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" className={buttonClass('ghost')} disabled={saving} onClick={close}>
            关闭
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            <Save aria-hidden className="size-4" />
            {saving ? '正在保存…' : '校验并保存'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

function ConfigFeedback({
  document,
  dirty,
  phase,
  message,
}: {
  document?: NativeConfigDocument;
  dirty: boolean;
  phase: Phase;
  message: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {document?.exists === false
            ? '文件尚未创建，保存后在本机创建。'
            : dirty
              ? '有未保存修改'
              : '当前内容与读取版本一致'}
        </span>
        <span>支持搜索；Tab 移至下一个控件；最大 256 KiB</span>
      </div>
      {message && (
        <p
          role={phase === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 text-sm ${phase === 'error' ? 'text-destructive-foreground' : 'text-accent'}`}
        >
          {phase === 'error' ? (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          {message}
        </p>
      )}
    </>
  );
}
