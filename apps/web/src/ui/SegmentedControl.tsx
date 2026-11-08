import type { ReactNode } from 'react';

type Option<Value extends string> = { value: Value; label: ReactNode };

/** 外观与焦点独立于业务；只传入当前值与选择事件，替换实现不改变会话状态。 */
export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly Option<Value>[];
  onChange(value: Value): void;
}) {
  return (
    <div role="group" aria-label={label} className="ui-segment">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
