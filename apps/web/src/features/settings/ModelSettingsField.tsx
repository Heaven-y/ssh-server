import { useId } from 'react';
import { CircleHelp } from 'lucide-react';
import type { ModelSettingField } from '@agentdeck/shared';
import { buttonClass, inputClass } from '../../ui/styles';

function SecretClear({
  field,
  cleared,
  disabled,
  change,
}: {
  field: ModelSettingField;
  cleared: boolean;
  disabled: boolean;
  change(value: string | null): void;
}) {
  if (!field.secret || !field.hasValue) return null;
  return (
    <button
      type="button"
      className={`${buttonClass('ghost')} shrink-0`}
      disabled={disabled}
      aria-label={`${cleared ? '保留' : '清除'}${field.label}`}
      onClick={() => change(cleared ? '' : null)}
    >
      {cleared ? '撤销清除' : '清除'}
    </button>
  );
}

export function ModelSettingsField({
  field,
  value,
  cleared,
  disabled,
  change,
}: {
  field: ModelSettingField;
  value: string;
  cleared: boolean;
  disabled: boolean;
  change(value: string | null): void;
}) {
  const id = useId();
  const placeholder = field.secret && field.hasValue ? '已设置 · 留空保留' : '沿用原生默认';
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium">
        {field.label}
        {field.hint && (
          <span title={field.hint} aria-hidden className="text-muted-foreground">
            <CircleHelp className="size-3.5" />
          </span>
        )}
      </label>
      <div className="flex items-center gap-2">
        {field.options ? (
          <select
            id={id}
            className={inputClass}
            disabled={disabled}
            value={value}
            onChange={(event) => change(event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type={field.secret ? 'password' : 'text'}
            className={inputClass}
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
            placeholder={cleared ? '保存后清除' : placeholder}
            onChange={(event) => change(event.target.value)}
          />
        )}
        <SecretClear field={field} cleared={cleared} disabled={disabled} change={change} />
      </div>
    </div>
  );
}
