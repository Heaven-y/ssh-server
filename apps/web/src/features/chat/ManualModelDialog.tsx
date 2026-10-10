import { useId, useState } from 'react';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';

export function ManualModelDialog({
  model,
  disabled,
  apply,
  onClose,
}: {
  model: string;
  disabled: boolean;
  apply(model: string): void;
  onClose(): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(model);
  const value = draft.trim();
  const invalid = value.length > 200 || /[\r\n\0]/.test(value) || ['默认', '默认模型'].includes(value);
  return (
    <DetailDialog title="手动填写模型" onClose={onClose}>
      <div className="space-y-4">
        <label htmlFor={id} className="block text-sm">
          模型名称
          <input
            id={id}
            className={`${inputClass} mt-2 font-mono`}
            value={draft}
            maxLength={200}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : `${id}-hint`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </label>
        <p id={`${id}-hint`} className="text-sm leading-6 text-muted-foreground">
          填写原生模型 ID，仅设置当前覆盖；恢复原生配置请使用“清除模型覆盖”。
        </p>
        {invalid && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive-foreground">
            请填写有效的原生模型 ID，不要填写“默认”等占位词。
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={disabled || !value || invalid}
            onClick={() => apply(value)}
          >
            应用模型
          </button>
        </div>
      </div>
    </DetailDialog>
  );
}
