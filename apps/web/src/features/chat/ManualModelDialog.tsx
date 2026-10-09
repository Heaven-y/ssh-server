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
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </label>
        <p className="text-sm leading-6 text-muted-foreground">填写模型 ID，留空使用默认值。</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={disabled}
            onClick={() => apply(draft.trim())}
          >
            应用模型
          </button>
        </div>
      </div>
    </DetailDialog>
  );
}
