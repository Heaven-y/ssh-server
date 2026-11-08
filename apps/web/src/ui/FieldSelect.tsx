import {
  Combobox,
  ComboboxDisclosure,
  ComboboxItem,
  ComboboxPopover,
  ComboboxSelect,
  useComboboxStore,
} from '@ariakit/react/combobox';
import { Check, ChevronDown } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { inputClass } from './styles';

export type FieldOption = { value: string; label: string };
type FieldProps = {
  id: string;
  label: string;
  value: string;
  options: FieldOption[];
  disabled?: boolean;
  readOnly?: boolean;
  onChange(value: string): void;
};

/** 原生 dialog 位于浏览器顶层；弹层留在所属 dialog，固定定位脱离表单滚动区域。 */
function fieldPortal(element: HTMLElement) {
  return element.closest('dialog') ?? element.ownerDocument.body;
}

const popoverProps = {
  portal: true,
  portalElement: fieldPortal,
  fixed: true,
  sameWidth: true,
  gutter: 6,
  flip: true,
  fitViewport: true,
  unmountOnHide: true,
  // Ariakit 关闭弹层只停止传播；取消默认行为，阻止同一次 Escape 再触发原生 dialog 的 cancel。
  hideOnEscape: (event: { preventDefault(): void }) => {
    event.preventDefault();
    return true;
  },
  className:
    'field-options z-[80] max-h-[min(280px,var(--popover-available-height))] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1.5 text-foreground shadow-lg',
} as const;

function OptionLabel({ option, selected }: { option: FieldOption; selected: boolean }) {
  return (
    <>
      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{option.label}</span>
      <Check aria-hidden className={`size-3.5 shrink-0 ${selected ? '' : 'invisible'}`} />
    </>
  );
}
const optionClass =
  'field-option flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] leading-5 outline-none data-active-item:bg-muted aria-selected:text-interactive';

/** 固定选项只在明确确认时写回，打开、方向键浏览和 Esc 均不覆盖配置。 */
export function FieldSelect({ id, label, value, options, disabled, readOnly, onChange }: FieldProps) {
  const store = useComboboxStore({ selectedValue: value, setSelectedValue: onChange, selectOnMove: false });
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <ComboboxSelect
        id={id}
        store={store}
        aria-label={label}
        disabled={disabled || readOnly}
        moveOnKeyDown={false}
        className={`${inputClass} field-select flex min-h-10 items-center justify-between gap-2 text-left`}
      >
        <span className="min-w-0 truncate">{selected?.label ?? value}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </ComboboxSelect>
      <ComboboxPopover store={store} {...popoverProps} aria-label={`${label}选项`}>
        {options.map((option) => (
          <ComboboxItem key={option.value} store={store} value={option.value} className={optionClass}>
            <OptionLabel option={option} selected={value === option.value} />
          </ComboboxItem>
        ))}
      </ComboboxPopover>
    </>
  );
}

/** 建议不限制手动输入；列表导航不把尚未确认的建议写进表单。 */
export function FieldSuggestions({
  id,
  label,
  value,
  options,
  disabled,
  readOnly,
  onChange,
  placeholder,
  inputRef,
}: FieldProps & { placeholder?: string; inputRef?: RefObject<HTMLInputElement | null> }) {
  const [filtering, setFiltering] = useState(false);
  const store = useComboboxStore({ inputValue: value, setInputValue: onChange, selectOnMove: false });
  const query = filtering ? value.trim().toLowerCase() : '';
  const matches = options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query));
  const canOpen = !disabled && !readOnly && options.length > 0;
  return (
    <div className="field-suggestions relative min-w-0 flex-1">
      <Combobox
        id={id}
        store={store}
        ref={inputRef}
        aria-label={label}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        autoComplete="list"
        autoSelect={false}
        showOnClick={canOpen}
        showOnChange={canOpen}
        showOnKeyPress={canOpen}
        onChange={() => setFiltering(true)}
        onFocus={() => setFiltering(false)}
        placeholder={placeholder}
        spellCheck={false}
        maxLength={4096}
        className={`${inputClass} min-h-10 pr-10 read-only:bg-muted/40 read-only:text-muted-foreground`}
      />
      {canOpen && (
        <ComboboxDisclosure
          store={store}
          aria-label={`展开${label}选项`}
          onClick={() => setFiltering(false)}
          className="field-disclosure absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </ComboboxDisclosure>
      )}
      <ComboboxPopover store={store} {...popoverProps} aria-label={`${label}选项`}>
        {matches.map((option) => (
          <ComboboxItem
            key={option.value}
            store={store}
            value={option.value}
            aria-selected={value === option.value}
            setValueOnClick={false}
            selectValueOnClick={false}
            onClick={() => {
              onChange(option.value);
              store.hide();
            }}
            className={optionClass}
          >
            <OptionLabel option={option} selected={value === option.value} />
          </ComboboxItem>
        ))}
        {!matches.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">没有匹配项</p>}
      </ComboboxPopover>
    </div>
  );
}
