import { useId } from 'react';
import { inputClass } from '../../ui/styles';
import { type ProductSettingsDraft } from './product-settings-draft';
import type { SettingsCategory } from './SettingsCategories';

type Props = {
  draft: ProductSettingsDraft;
  disabled: boolean;
  showErrors: boolean;
  change(patch: Partial<ProductSettingsDraft>): void;
  validate(): void;
};
export function invalidSettingsCategory(): SettingsCategory {
  return 'conversation';
}

export function ProductSettingsForm({ ...props }: Props & { category: Exclude<SettingsCategory, 'environment'> }) {
  const id = useId();
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium">新会话默认值</h3>
        <p className="text-sm leading-6 text-muted-foreground">用于新会话，已有会话和当前轮次保持原设置。</p>
      </div>
      <label htmlFor={`${id}-agent`} className="flex max-w-xs flex-col gap-1.5 text-sm">
        默认 Agent
        <select
          id={`${id}-agent`}
          className={inputClass}
          disabled={props.disabled}
          value={props.draft.defaultAgent}
          onChange={(event) =>
            props.change({ defaultAgent: event.target.value as ProductSettingsDraft['defaultAgent'] })
          }
        >
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
          <option value="antigravity">Antigravity</option>
        </select>
      </label>
    </section>
  );
}
