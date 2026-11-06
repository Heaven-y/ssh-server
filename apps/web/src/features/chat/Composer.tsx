import { ArrowUp, Square } from 'lucide-react';
import { useId, type FormEvent } from 'react';
import { managementPending, useChat } from './chat-store';
import { CapabilityPicker } from './CapabilityPicker';
import { selectionRestriction } from './capability-selection';
import { ComposerInput } from './ComposerInput';
import type { AgentCapability } from '@agentdeck/shared/conversation';
import { AgentControls } from './AgentControls';
import { ComposerStatus } from './ComposerStatus';

function ComposerActions({ disabled }: { disabled: boolean }) {
  const running = useChat((s) => s.running);
  const stopping = useChat((s) => s.interruptRequested);
  const loading = useChat((s) => s.loadingHistory);
  const historyError = useChat((s) => s.historyError);
  const managing = useChat(managementPending);
  const interrupt = useChat((s) => s.interrupt);
  const hint = loading
    ? '正在读取历史，请稍候…'
    : historyError
      ? '请先重新读取历史'
      : managing
        ? '正在管理当前会话，请稍候…'
        : undefined;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {hint && (
        <p role="status" className="max-w-36 text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      )}
      {running ? (
        <button
          type="button"
          aria-label={stopping ? '正在停止' : '停止'}
          title={stopping ? '正在停止…' : '停止'}
          className="composer-submit"
          disabled={stopping}
          onClick={interrupt}
        >
          <Square aria-hidden className="size-4" />
          <span className="sr-only">{stopping ? '正在停止…' : '停止'}</span>
        </button>
      ) : (
        <button type="submit" aria-label="发送" title="发送" className="composer-submit" disabled={disabled}>
          <ArrowUp aria-hidden className="size-5" />
        </button>
      )}
    </div>
  );
}

function placeholder(connected: boolean, hint?: string): string {
  return connected ? hint || '描述你想完成的任务…' : '等待连接…';
}
const emptyInput = (text: string, selection: AgentCapability | undefined) => !text.trim() && !selection;

/** 输入框：Enter 发送、Shift+Enter 换行（输入法组字时不发送）；运行中按钮变为"停止" */
export function Composer() {
  const id = useId();
  const text = useChat((s) => s.draft);
  const setText = useChat((s) => s.setDraft);
  const running = useChat((s) => s.running);
  const connected = useChat((s) => s.connection === 'open');
  const loading = useChat((s) => s.loadingHistory);
  const historyError = useChat((s) => s.historyError);
  const selection = useChat((s) => s.selectedCapability);
  const sessionId = useChat((s) => s.sessionId);
  const managing = useChat(managementPending);
  const send = useChat((s) => s.send);
  const restriction = selectionRestriction(selection, sessionId, text);
  const busy = running || loading || managing;
  const empty = emptyInput(text, selection);
  const blocked = !connected || empty || busy || !!historyError || !!restriction;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    send(text.trim());
  };

  return (
    <form onSubmit={submit} className="composer">
      <div className="composer-card">
        <label htmlFor={id} className="sr-only">
          输入消息
        </label>
        <ComposerInput
          id={id}
          text={text}
          onChange={setText}
          onSend={submit}
          busy={busy}
          placeholder={placeholder(connected, selection?.argumentHint)}
        />
        {restriction && <p className="px-4 text-xs leading-5 text-warning">{restriction}</p>}
        <div role="group" aria-label="消息选项" className="composer-toolbar">
          <CapabilityPicker disabled={busy} />
          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
            <AgentControls disabled={busy} />
            <ComposerActions disabled={blocked} />
          </div>
        </div>
      </div>
      <ComposerStatus />
    </form>
  );
}
