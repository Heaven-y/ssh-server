import { useEffect, useRef, useState } from 'react';
import { buttonClass } from '../../ui/styles';
import { TerminalPasteDialog } from '../terminal/TerminalDialogs';
import { prepareTerminalPaste } from '../terminal/paste';
import { createConsoleTerminalRuntime } from './terminal-runtime';

export function ConsoleTerminalPane({
  serverId,
  terminalId,
  visible,
  focused,
}: {
  serverId: string;
  terminalId: string;
  visible: boolean;
  focused: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<ReturnType<typeof createConsoleTerminalRuntime> | undefined>(undefined);
  const [status, setStatus] = useState('正在恢复终端…');
  const [paste, setPaste] = useState<string>();
  useEffect(() => {
    const instance = createConsoleTerminalRuntime({
      host: host.current!,
      serverId,
      terminalId,
      status: setStatus,
      paste: (text) => {
        try {
          prepareTerminalPaste(text);
          if (/[\r\n]/.test(text)) setPaste(text);
          else instance.paste(text);
        } catch (reason) {
          setStatus((reason as Error).message);
        }
      },
    });
    runtime.current = instance;
    return () => {
      instance.dispose();
      runtime.current = undefined;
    };
  }, [serverId, terminalId]);
  useEffect(() => {
    runtime.current?.setVisible(visible);
    if (visible && focused) runtime.current?.focus();
  }, [visible, focused]);
  return (
    <section
      hidden={!visible}
      aria-label={`终端 ${terminalId}`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded border border-border bg-background"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <p role="status" className="min-w-0 flex-1 truncate text-muted-foreground" title={status}>
          {status}
        </p>
        <button type="button" className={buttonClass('ghost')} onClick={() => void runtime.current?.copy()}>
          复制
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={() => void runtime.current?.readClipboard()}>
          粘贴
        </button>
      </header>
      <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-hidden px-1 pt-1" />
      {visible && paste !== undefined && (
        <TerminalPasteDialog
          text={paste}
          cancel={() => setPaste(undefined)}
          confirm={() => {
            runtime.current?.paste(paste);
            setPaste(undefined);
            runtime.current?.focus();
          }}
        />
      )}
    </section>
  );
}
