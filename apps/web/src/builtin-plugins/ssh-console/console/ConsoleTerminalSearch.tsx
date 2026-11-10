import { useRef, useState } from 'react';
import { buttonClass, inputClass } from '../../../ui/styles';
import type { TerminalSearchResults } from './terminal-search';

export function ConsoleTerminalSearch({
  find,
  close,
  results,
}: {
  find(text: string, backwards: boolean, incremental?: boolean): boolean;
  close(): void;
  results: TerminalSearchResults | null;
}) {
  const [text, setText] = useState('');
  const composing = useRef(false);
  const [missing, setMissing] = useState(false);
  const search = (backwards: boolean) => setMissing(!find(text, backwards));
  return (
    <form
      aria-label="终端查找"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text) search(false);
      }}
    >
      <input
        autoFocus
        aria-label="查找终端文本"
        className={`${inputClass} min-w-24 flex-1`}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setMissing(false);
          if (!composing.current) find(event.target.value, false, true);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          find(event.currentTarget.value, false, true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            if (event.key === 'Enter') event.preventDefault();
            return;
          }
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            if (text) search(true);
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        }}
      />
      {results && results.total > 0 && (
        <span role="status" className="text-xs text-muted-foreground">
          {results.index ? `${results.index} / ${results.total}` : `${results.total} 处匹配`}
        </span>
      )}
      <button type="button" className={buttonClass('ghost')} disabled={!text} onClick={() => search(true)}>
        上一处
      </button>
      <button type="submit" className={buttonClass('ghost')} disabled={!text}>
        下一处
      </button>
      <button type="button" className={buttonClass('ghost')} onClick={close}>
        关闭查找
      </button>
      {(missing || results?.total === 0) && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          当前终端回滚中没有匹配文本。
        </p>
      )}
    </form>
  );
}
