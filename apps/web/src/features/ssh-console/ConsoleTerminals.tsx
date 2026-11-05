import { useState } from 'react';
import { Columns2, Rows2, Plus, RefreshCw, X } from 'lucide-react';
import { SSH_CONSOLE_LIMITS } from '@agentdeck/shared';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { ConsoleTerminalPane } from './ConsoleTerminalPane';
import { useConsoleTerminals } from './use-console-terminals';

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
  const [split, setSplit] = useState<'horizontal' | 'vertical'>();
  const [closing, setClosing] = useState<string>();
  return (
    <section aria-label="服务器终端" className="flex min-h-0 flex-1 flex-col">
      <TerminalToolbar state={state} split={split} setSplit={setSplit} />
      <div
        role="group"
        aria-label="终端标签"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-1"
      >
        {state.terminals.map((terminal, index) => (
          <div key={terminal.id} className="flex items-center">
            <button
              type="button"
              className={buttonClass(state.selected === terminal.id ? 'outline' : 'ghost')}
              aria-pressed={state.selected === terminal.id}
              onClick={() => state.select(terminal.id)}
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
      <TerminalPanes state={state} serverId={serverId} visible={visible} split={split} />
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
function TerminalPanes({
  state,
  serverId,
  visible,
  split,
}: {
  state: TerminalsState;
  serverId: string;
  visible: boolean;
  split?: 'horizontal' | 'vertical';
}) {
  const second = state.terminals.find((item) => item.id !== state.selected)?.id;
  const displayed = split && second ? [state.selected, second] : [state.selected];
  return (
    <div
      className={`grid min-h-0 flex-1 gap-2 p-3 ${split === 'horizontal' && second ? 'grid-cols-2' : split === 'vertical' && second ? 'grid-rows-2' : 'grid-cols-1'}`}
    >
      {state.terminals.map((terminal) => (
        <div key={terminal.id} hidden={!displayed.includes(terminal.id)} className="min-h-0 min-w-0">
          <ConsoleTerminalPane
            serverId={serverId}
            terminalId={terminal.id}
            visible={visible && displayed.includes(terminal.id)}
            focused={terminal.id === state.selected}
          />
        </div>
      ))}
    </div>
  );
}
function TerminalToolbar({
  state,
  split,
  setSplit,
}: {
  state: TerminalsState;
  split?: 'horizontal' | 'vertical';
  setSplit(value?: 'horizontal' | 'vertical'): void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2">
      <button
        type="button"
        className={buttonClass('outline')}
        disabled={!state.ready || state.busy || state.terminals.length >= SSH_CONSOLE_LIMITS.terminalsPerServer}
        onClick={() => void state.create()}
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
        disabled={state.terminals.length < 2}
        aria-pressed={split === 'horizontal'}
        onClick={() => setSplit('horizontal')}
      >
        <Columns2 aria-hidden className="size-4" />
        左右分屏
      </button>
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={state.terminals.length < 2}
        aria-pressed={split === 'vertical'}
        onClick={() => setSplit('vertical')}
      >
        <Rows2 aria-hidden className="size-4" />
        上下分屏
      </button>
      {split && (
        <button type="button" className={buttonClass('ghost')} onClick={() => setSplit(undefined)}>
          取消分屏
        </button>
      )}
      <p className="ml-auto self-center text-xs text-muted-foreground">
        每台最多 {SSH_CONSOLE_LIMITS.terminalsPerServer} 个终端 · 切页保留
      </p>
    </div>
  );
}
