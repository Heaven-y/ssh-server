import { SendHorizontal, Square } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { buttonClass } from '../../ui/styles';
import { managementPending, useChat } from './chat-store';
import { CapabilityPicker } from './CapabilityPicker';
import { selectionRestriction } from './capability-selection';
import { ContextStatus } from './ContextStatus';
import { ComposerInput } from './ComposerInput';

function ComposerActions({ disabled }: { disabled: boolean }) {
  const running = useChat((s) => s.running);
  const stopping = useChat((s) => s.interruptRequested);
  const loading = useChat((s) => s.loadingHistory);
  const managing = useChat(managementPending);
  const interrupt = useChat((s) => s.interrupt);
  const hint = loading
    ? '正在读取历史，请稍候…'
    : managing
      ? '正在管理当前会话，请稍候…'
      : 'Enter 发送 · Shift+Enter 换行';
  return (
    <div className="flex items-end justify-between gap-3">
      <p className="pb-1 text-xs leading-5 text-muted-foreground">{hint}</p>
      {running ? (
        <button
          type="button"
          className={`${buttonClass('danger')} shrink-0 whitespace-nowrap`}
          disabled={stopping}
          onClick={interrupt}
        >
          <Square aria-hidden className="size-4" />
          {stopping ? '正在停止…' : '停止'}
        </button>
      ) : (
        <button type="submit" className={`${buttonClass('primary')} shrink-0 whitespace-nowrap`} disabled={disabled}>
          <SendHorizontal aria-hidden className="size-4" />
          发送
        </button>
      )}
    </div>
  );
}

function placeholder(connected: boolean, hint?: string): string {
  return connected ? hint || '描述你想完成的任务…' : '等待连接…';
}

/** 输入框：Enter 发送、Shift+Enter 换行（输入法组字时不发送）；运行中按钮变为"停止" */
export function Composer() {
  const id = useId();
  const [text, setText] = useState('');
  const running = useChat((s) => s.running);
  const connected = useChat((s) => s.connection === 'open');
  const loading = useChat((s) => s.loadingHistory);
  const selection = useChat((s) => s.selectedCapability);
  const sessionId = useChat((s) => s.sessionId);
  const managing = useChat(managementPending);
  const send = useChat((s) => s.send);
  const restriction = selectionRestriction(selection, sessionId, text);
  const busy = running || loading || managing;
  const empty = !text.trim() && !selection;
  const blocked = !connected || empty || busy || !!restriction;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (send(text.trim())) setText('');
  };

  return (
    <form onSubmit={submit} className="shrink-0 space-y-2 px-4 pt-2 pb-4 sm:px-6">
      <ContextStatus />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl border border-border-strong bg-card p-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 sm:p-4">
        <CapabilityPicker disabled={busy} />
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
        {restriction && <p className="text-xs leading-5 text-warning">{restriction}</p>}
        <ComposerActions disabled={blocked} />
      </div>
    </form>
  );
}
