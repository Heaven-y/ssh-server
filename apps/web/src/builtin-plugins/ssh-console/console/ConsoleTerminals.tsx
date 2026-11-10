import { useState } from 'react';
import { Columns2, Rows2, Plus, RefreshCw, X } from 'lucide-react';
import { SSH_CONSOLE_LIMITS } from '@agentdeck/shared/ssh';
import { buttonClass } from '../../../ui/styles';
import { DetailDialog } from '../../../ui/DetailDialog';
import { ConsoleTerminalPane } from './ConsoleTerminalPane';
import { useConsoleTerminals } from './use-console-terminals';
import { useConsolePanes } from './use-console-panes';

export default function ConsoleTerminals({
  serverId,
  directory,
  visible,
}: {
  serverId: string;
  directory: string;
  visible: boolean;
}) {
  const state = useConsoleTerminals(serverId, directory, visible);
  const layout = useConsolePanes(state);
  const [closing, setClosing] = useState<string>();
  return (
    <section aria-label="服务器终端" className="flex min-h-0 flex-1 flex-col">
      <TerminalToolbar state={state} layout={layout} />
      <div
        role="group"
        aria-label="终端标签"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-1"
      >
        {state.terminals.map((terminal, index) => (
          <div key={terminal.id} className="flex items-center">
            <button
              type="button"
              className={buttonClass(layout.focused === terminal.id ? 'outline' : 'ghost')}
              aria-pressed={layout.focused === terminal.id}
              onClick={() => layout.show(terminal.id)}
            >
              终端 {index + 1}
            </button>
            <button
              type="button"
              aria-label={`关闭终端 ${index + 1}`}
              className={buttonClass('ghost')}
              disabled={state.busy}
              onClick={() => setClosing(terminal.id)}
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        ))}
      </div>
      {state.error && (
        <div className="flex shrink-0 items-center gap-2 p-3">
          <p role="alert" className="text-sm text-destructive-foreground">
            {state.error}
          </p>
          <button type="button" className={buttonClass('outline')} onClick={state.retry} disabled={state.busy}>
            重新读取终端
          </button>
        </div>
      )}
      {!state.ready && (
        <p role="status" className="p-4 text-sm">
          正在恢复服务器终端…
        </p>
      )}
      <TerminalPanes state={state} serverId={serverId} visible={visible} layout={layout} />
      {closing && visible && (
        <DetailDialog title="关闭终端" busy={state.busy} onClose={() => setClosing(undefined)}>
          <p className="text-sm leading-6">关闭会结束此终端的 shell，可能中断正在执行的命令。其他终端继续保留。</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={state.busy}
              onClick={() => setClosing(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              className={buttonClass('danger')}
              disabled={state.busy}
              onClick={() => {
                void state.close(closing).then(() => setClosing(undefined));
              }}
            >
              确认关闭终端
            </button>
          </div>
        </DetailDialog>
      )}
    </section>
  );
}
type TerminalsState = ReturnType<typeof useConsoleTerminals>;
type PanesState = ReturnType<typeof useConsolePanes>;
function TerminalPanes({
  state,
  serverId,
  visible,
  layout,
}: {
  state: TerminalsState;
  serverId: string;
  visible: boolean;
  layout: PanesState;
}) {
  const ordered = [
    ...layout.shown,
    ...state.terminals.map((item) => item.id).filter((id) => !layout.shown.includes(id)),
  ];
  return (
    <div
      className={`grid min-h-0 flex-1 gap-2 p-3 ${layout.direction === 'horizontal' ? 'grid-cols-2' : layout.direction === 'vertical' ? 'grid-rows-2' : 'grid-cols-1'}`}
    >
      {ordered.map((id) => (
        <div
          key={id}
          hidden={!layout.shown.includes(id)}
          className={`min-h-0 min-w-0 rounded ${layout.focused === id && layout.direction ? 'ring-1 ring-accent' : ''}`}
          onPointerDownCapture={() => layout.focus(id)}
          onFocusCapture={() => layout.focus(id)}
        >
          <ConsoleTerminalPane
            serverId={serverId}
            terminalId={id}
            visible={visible && layout.shown.includes(id)}
            focused={id === layout.focused}
          />
        </div>
      ))}
    </div>
  );
}
function TerminalToolbar({ state, layout }: { state: TerminalsState; layout: PanesState }) {
  return (
    <div className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
      <button
        type="button"
        className={buttonClass('outline')}
        disabled={!state.ready || state.busy || state.terminals.length >= SSH_CONSOLE_LIMITS.terminalsPerServer}
        onClick={() => void layout.create()}
      >
        <Plus aria-hidden className="size-4" />
        新建终端
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={!state.ready || state.busy}
        onClick={state.retry}
      >
        <RefreshCw aria-hidden className="size-4" />
        恢复终端列表
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={!state.terminals.length || state.busy}
        aria-pressed={layout.direction === 'horizontal'}
        onClick={() => void layout.split('horizontal')}
      >
        <Columns2 aria-hidden className="size-4" />
        左右分屏
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={!state.terminals.length || state.busy}
        aria-pressed={layout.direction === 'vertical'}
        onClick={() => void layout.split('vertical')}
      >
        <Rows2 aria-hidden className="size-4" />
        上下分屏
      </button>
      {layout.direction && (
        <button type="button" className={buttonClass('ghost')} onClick={layout.unsplit}>
          取消分屏
        </button>
      )}
      <p className="ml-auto self-center text-xs text-muted-foreground">
        每台最多 {SSH_CONSOLE_LIMITS.terminalsPerServer} 个终端 · 切页保留
      </p>
    </div>
  );
}
