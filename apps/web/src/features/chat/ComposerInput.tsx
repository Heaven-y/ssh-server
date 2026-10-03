import { Combobox, ComboboxItem, ComboboxPopover, useComboboxStore } from '@ariakit/react/combobox';
import { useRef, useState } from 'react';
import type { AgentCapability } from '@ssh-server/shared';
import { capabilityRestriction } from './capability-selection';
import { useChat } from './chat-store';
import { matchesCapability, slashCompletion } from './slash-completion';
import { useAgentCapabilities } from './use-agent-capabilities';

const MAX_SUGGESTIONS = 20;
type InputProps = {
  id: string;
  text: string;
  onChange(text: string): void;
  onSend(): void;
  placeholder: string;
  busy: boolean;
};

function Suggestion({ entry, select }: { entry: AgentCapability; select(): void }) {
  const sessionId = useChat((state) => state.sessionId);
  const reason = capabilityRestriction(entry, sessionId);
  return (
    <ComboboxItem
      value={entry.id}
      disabled={!!reason}
      setValueOnClick={false}
      selectValueOnClick={false}
      onClick={select}
      className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="break-all font-medium">/{entry.name}</span>
        <span className="text-xs text-muted-foreground">{entry.kind === 'skill' ? '技能' : '命令'}</span>
        {entry.source && <span className="break-all text-xs text-muted-foreground">{entry.source}</span>}
      </div>
      <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{entry.description}</p>
      {reason && <p className="mt-1 break-words text-xs leading-5 text-warning">{reason}</p>}
    </ComboboxItem>
  );
}

function SuggestionsFooter({ count, ready }: { count: number; ready: boolean }) {
  if (!ready) return null;
  if (!count) return <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配的技能或命令。</p>;
  return count > MAX_SUGGESTIONS ? (
    <p className="px-3 py-2 text-xs text-muted-foreground">显示前 {MAX_SUGGESTIONS} 项，继续输入可缩小范围。</p>
  ) : null;
}

/** 使用成熟 combobox 保持输入焦点；菜单只负责选择，发送继续经过原有 store 和后端复验。 */
function ScopedInput({ id, text, onChange, onSend, placeholder, busy }: InputProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState({ start: text.length, end: text.length });
  const [requested, setRequested] = useState(false);
  const [composing, setComposing] = useState(false);
  const selection = useChat((state) => state.selectedCapability);
  const select = useChat((state) => state.selectCapability);
  const completion = slashCompletion(text, range.start, range.end);
  const eligible = !busy && !selection && !!completion && !composing;
  const open = requested && eligible;
  const catalog = useAgentCapabilities(open);
  const matches = (catalog.data?.entries ?? []).filter((entry) => matchesCapability(entry, completion?.query ?? ''));
  const store = useComboboxStore({
    inputValue: text,
    setInputValue: onChange,
    open,
    setOpen: setRequested,
    placement: 'top-start',
  });

  const choose = (entry: AgentCapability) => {
    select(entry);
    if (useChat.getState().selectedCapability?.id !== entry.id || !completion) return;
    onChange(completion.remainder);
    setRange({ start: completion.remainder.length, end: completion.remainder.length });
    store.hide();
    input.current?.focus();
  };
  const show = () => {
    const element = input.current;
    return (
      !busy && !selection && !!element && !!slashCompletion(element.value, element.selectionStart, element.selectionEnd)
    );
  };
  const syncRange = () => {
    const element = input.current;
    if (element) setRange({ start: element.selectionStart, end: element.selectionEnd });
  };

  return (
    <>
      <Combobox
        id={id}
        store={store}
        render={<textarea ref={input} rows={2} />}
        autoSelect="always"
        autoComplete="list"
        showOnChange={show}
        showOnClick={show}
        showOnKeyPress={show}
        moveOnKeyPress={open}
        onChange={syncRange}
        onSelect={syncRange}
        onKeyUp={syncRange}
        onPointerUp={syncRange}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDownCapture={(event) => {
          if (event.key !== 'Enter') return;
          if (event.nativeEvent.isComposing) {
            event.stopPropagation();
            return;
          }
          if (event.shiftKey) {
            if (open && input.current) {
              event.preventDefault();
              input.current.setRangeText('\n', input.current.selectionStart, input.current.selectionEnd, 'end');
              onChange(input.current.value);
              store.hide();
            }
            return;
          }
          if (open) return;
          event.preventDefault();
          onSend();
        }}
        placeholder={placeholder}
        className="max-h-60 min-h-16 w-full min-w-0 resize-none bg-transparent text-[15px] leading-7 text-foreground placeholder:text-muted-foreground focus-visible:outline-none [field-sizing:content]"
      />
      <ComboboxPopover
        store={store}
        portal
        gutter={12}
        sameWidth
        aria-label="原生命令补全"
        className="z-50 max-h-[min(360px,var(--popover-available-height))] overflow-y-auto rounded-xl border border-border-strong bg-card p-2 text-foreground shadow-xl"
      >
        <p role="status" className="px-3 py-2 text-xs leading-5 text-muted-foreground">
          {catalog.isFetching ? '正在读取原生能力…' : '↑ ↓ 选择 · Enter 确认 · Esc 关闭'}
        </p>
        {catalog.isError && (
          <p role="alert" className="px-3 py-2 text-xs text-warning">
            能力目录暂不可用，可按 Esc 关闭后继续输入。
          </p>
        )}
        {matches.slice(0, MAX_SUGGESTIONS).map((entry) => (
          <Suggestion key={entry.id} entry={entry} select={() => choose(entry)} />
        ))}
        <SuggestionsFooter count={matches.length} ready={!!catalog.data} />
      </ComboboxPopover>
    </>
  );
}

export function ComposerInput(props: InputProps) {
  const scope = useChat((state) => JSON.stringify([state.workspaceId, state.agent, state.sessionId]));
  return <ScopedInput key={scope} {...props} />;
}
