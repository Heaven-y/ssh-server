import { SendHorizontal, Square } from 'lucide-react';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { buttonClass } from '../../ui/styles';
import { useChat } from './chat-store';

/** 输入框：Enter 发送、Shift+Enter 换行（输入法组字时不发送）；运行中按钮变为"停止" */
export function Composer() {
  const id = useId();
  const [text, setText] = useState('');
  const running = useChat((s) => s.running);
  const connected = useChat((s) => s.connection === 'open');
  const send = useChat((s) => s.send);
  const interrupt = useChat((s) => s.interrupt);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || running || !connected) return;
    send(value);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="shrink-0 px-4 pt-2 pb-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-xl border border-border-strong bg-card p-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 sm:p-4">
        <label htmlFor={id} className="sr-only">
          输入消息
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={connected ? '描述你想完成的任务…' : '等待连接…'}
          className="max-h-60 min-h-16 w-full min-w-0 resize-none bg-transparent text-[15px] leading-7 text-foreground placeholder:text-muted-foreground focus-visible:outline-none [field-sizing:content]"
        />
        <div className="flex items-end justify-between gap-3">
          <p className="pb-1 text-xs leading-5 text-muted-foreground">
            {running ? '正在处理，可随时停止' : 'Enter 发送 · Shift+Enter 换行'}
          </p>
          {running ? (
            <button type="button" className={`${buttonClass('danger')} shrink-0 whitespace-nowrap`} onClick={interrupt}>
              <Square aria-hidden className="size-4" />
              停止
            </button>
          ) : (
            <button
              type="submit"
              className={`${buttonClass('primary')} shrink-0 whitespace-nowrap`}
              disabled={!connected || !text.trim()}
            >
              <SendHorizontal aria-hidden className="size-4" />
              发送
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
