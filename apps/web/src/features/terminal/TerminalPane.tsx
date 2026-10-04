import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { TerminalTarget } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { createTerminalRuntime, type TerminalRuntime, type TerminalPaneStatus } from './runtime';
import { prepareTerminalPaste } from './paste';
import { TerminalPasteDialog } from './TerminalDialogs';

export type { TerminalPaneStatus } from './runtime';
function PaneHeader({
  target,
  status,
  copy,
  paste,
}: {
  target: TerminalTarget;
  status: TerminalPaneStatus;
  copy: () => void;
  paste: () => void;
}) {
  const interactive = status.phase === 'ready' || status.phase === 'paused';
  const label = `${target.sshHost} · ${target.authMode === 'password' ? '密码' : '私钥'} · 起始目录 ${status.startDir ?? target.remoteDir}`;
  return (
    <header className="flex shrink-0 items-center gap-2 overflow-hidden border-b border-border px-2 py-1 text-xs">
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      <span
        role="status"
        className={`truncate ${interactive ? 'text-muted-foreground' : 'text-warning'}`}
        title={status.message}
      >
        {status.message}
      </span>
      <button type="button" className={buttonClass('ghost')} onClick={copy}>
        复制
      </button>
      <button type="button" disabled={!interactive} className={buttonClass('ghost')} onClick={paste}>
        粘贴
      </button>
    </header>
  );
}
export function TerminalPane({
  paneId,
  target,
  binding,
  visible,
  active,
  style,
  onState,
  onFocus,
}: {
  paneId: string;
  target: TerminalTarget;
  binding: string;
  visible: boolean;
  active: boolean;
  style: CSSProperties;
  onState: (id: string, state: TerminalPaneStatus) => void;
  onFocus: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<TerminalRuntime | undefined>(undefined);
  const [status, setStatus] = useState<TerminalPaneStatus>({ phase: 'connecting', message: '正在开启终端…' });
  const [pasteText, setPasteText] = useState<string>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const element = host.current!;
    const instance = createTerminalRuntime({
      host: element,
      target,
      binding,
      status: (value) => {
        setStatus(value);
        onState(paneId, value);
      },
      notice: setNotice,
      pending: setPending,
      paste: (text) => {
        try {
          prepareTerminalPaste(text);
          if (/[\r\n]/.test(text)) setPasteText(text);
          else instance.paste(text);
        } catch (error) {
          setNotice((error as Error).message);
        }
      },
    });
    runtime.current = instance;
    return () => {
      instance.dispose();
      runtime.current = undefined;
    };
  }, [paneId, target, binding, onState]);
  useEffect(() => {
    runtime.current?.setVisible(visible);
    if (visible && active) runtime.current?.focus();
  }, [visible, active]);
  return (
    <section
      data-terminal-pane={paneId}
      aria-label={`终端 ${target.sshHost}`}
      style={{ ...style, display: visible ? undefined : 'none' }}
      className={`absolute flex min-h-0 min-w-0 flex-col bg-background ${active ? 'ring-1 ring-inset ring-accent' : ''}`}
      onFocusCapture={() => onFocus(paneId)}
    >
      <PaneHeader
        target={target}
        status={status}
        copy={() => {
          void runtime.current?.copy();
        }}
        paste={() => {
          void runtime.current?.readClipboard();
        }}
      />
      <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-hidden px-1 pt-1" />
      {(notice || pending) && (
        <div role="status" className="flex shrink-0 items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{pending ? '粘贴正在发送或等待缓冲恢复' : notice}</span>
          {pending && (
            <button type="button" className={buttonClass('ghost')} onClick={() => runtime.current?.cancelPaste()}>
              取消剩余粘贴
            </button>
          )}
        </div>
      )}
      {pasteText !== undefined && (
        <TerminalPasteDialog
          text={pasteText}
          cancel={() => {
            setPasteText(undefined);
            runtime.current?.focus();
          }}
          confirm={() => {
            runtime.current?.paste(pasteText);
            setPasteText(undefined);
            runtime.current?.focus();
          }}
        />
      )}
    </section>
  );
}
