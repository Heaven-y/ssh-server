import { SendHorizontal, Square } from 'lucide-react';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { buttonClass, inputClass } from '../../ui/styles';
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
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
      <label htmlFor={id} className="sr-only">
        输入消息
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={connected ? '输入消息，Enter 发送，Shift+Enter 换行' : '等待连接…'}
        className={`${inputClass} max-h-60 min-h-12 resize-none [field-sizing:content]`}
      />
      {running ? (
        <button type="button" className={buttonClass('danger')} onClick={interrupt}>
          <Square aria-hidden className="size-4" />
          停止
        </button>
      ) : (
        <button type="submit" className={buttonClass('primary')} disabled={!connected || !text.trim()}>
          <SendHorizontal aria-hidden className="size-4" />
          发送
        </button>
      )}
    </form>
  );
}
