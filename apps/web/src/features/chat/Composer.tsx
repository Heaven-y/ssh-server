import { ArrowUp, Square } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { managementPending, useChat } from './chat-store';
import { CapabilityPicker } from './CapabilityPicker';
import { selectionRestriction } from './capability-selection';
import { ComposerInput } from './ComposerInput';
import { PendingFeedback } from '../changes/PendingFeedback';
import type { AgentCapability } from '@ssh-server/shared';
import { AgentControls } from './AgentControls';

function ComposerActions({ disabled }: { disabled: boolean }) {
  const running = useChat((s) => s.running);
  const stopping = useChat((s) => s.interruptRequested);
  const loading = useChat((s) => s.loadingHistory);
  const managing = useChat(managementPending);
  const interrupt = useChat((s) => s.interrupt);
  const hint = loading ? '正在读取历史，请稍候…' : managing ? '正在管理当前会话，请稍候…' : undefined;
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
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={stopping}
          onClick={interrupt}
        >
          <Square aria-hidden className="size-4" />
          <span className="sr-only">{stopping ? '正在停止…' : '停止'}</span>
        </button>
      ) : (
        <button
          type="submit"
          aria-label="发送"
          title="发送"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={disabled}
        >
          <ArrowUp aria-hidden className="size-5" />
        </button>
      )}
    </div>
  );
}

function placeholder(connected: boolean, hint?: string): string {
  return connected ? hint || '描述你想完成的任务…' : '等待连接…';
}
function feedbackRestriction(
  selection: AgentCapability | undefined,
  sessionId: string | undefined,
  text: string,
  feedback: boolean,
) {
  return feedback && selection
    ? '请先取消技能或命令选择，再发送行内反馈'
    : selectionRestriction(selection, sessionId, text);
}
const emptyInput = (text: string, selection: AgentCapability | undefined, feedback: boolean) =>
  !text.trim() && !selection && !feedback;

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
  const touchDraft = useChat((s) => s.touchDraft);
  const hasFeedback = useChat((s) => s.feedback.length > 0);
  const restriction = feedbackRestriction(selection, sessionId, text, hasFeedback);
  const busy = running || loading || managing;
  const empty = emptyInput(text, selection, hasFeedback);
  const blocked = !connected || empty || busy || !!restriction;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (send(text.trim())) setText('');
  };

  return (
    <form onSubmit={submit} className="shrink-0 space-y-2 px-4 pt-2 pb-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-[28px] border border-border-strong bg-card p-3 shadow-sm transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 sm:p-4">
        <PendingFeedback />
        <label htmlFor={id} className="sr-only">
          输入消息
        </label>
        <ComposerInput
          id={id}
          text={text}
          onChange={(value) => {
            touchDraft();
            setText(value);
          }}
          onSend={submit}
          busy={busy}
          placeholder={placeholder(connected, selection?.argumentHint)}
        />
        {restriction && <p className="text-xs leading-5 text-warning">{restriction}</p>}
        <div role="group" aria-label="消息选项" className="flex flex-wrap items-center gap-2">
          <CapabilityPicker disabled={busy} />
          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
            <AgentControls disabled={busy} />
            <ComposerActions disabled={blocked} />
          </div>
        </div>
      </div>
    </form>
  );
}
