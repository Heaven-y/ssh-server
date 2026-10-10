import { useId } from 'react';
import { inputClass } from '../../ui/styles';
import { type ProductSettingsDraft, draftErrors } from './product-settings-draft';
import type { SettingsCategory } from './SettingsCategories';

type Field = {
  key: Exclude<keyof ProductSettingsDraft, 'defaultAgent'>;
  label: string;
  hint: string;
  min?: number;
  max?: number;
  step?: string;
};
const sync: Field[] = [
  {
    key: 'maxFileMiB',
    label: '默认单文件上限（MiB）',
    hint: '1 字节–100 MiB，大文件留在服务器。',
    min: 1 / 1024 / 1024,
    max: 100,
    step: 'any',
  },
  { key: 'extensions', label: '默认排除扩展名', hint: '逗号分隔英文字母或数字；.git 始终排除。' },
  {
    key: 'syncInterval',
    label: '自动同步间隔（秒）',
    hint: '5–300 秒，默认 60 秒。',
    min: 5,
    max: 300,
  },
];
const resources: Field[] = [
  { key: 'resourceInterval', label: '资源检查间隔（秒）', hint: '2–60 秒；页面隐藏时暂停。', min: 2, max: 60 },
  {
    key: 'resourceTimeout',
    label: '资源采样超时（秒）',
    hint: '2–30 秒；超时保留最近数据并标记过期。',
    min: 2,
    max: 30,
  },
];
type Props = {
  draft: ProductSettingsDraft;
  disabled: boolean;
  showErrors: boolean;
  change(patch: Partial<ProductSettingsDraft>): void;
  validate(): void;
};
function Fields({ fields, ...props }: Props & { fields: Field[] }) {
  const id = useId();
  const errors = props.showErrors ? draftErrors(props.draft) : {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <label key={field.key} htmlFor={`${id}-${field.key}`} className="flex min-w-0 flex-col gap-1.5 text-sm">
          {field.label}
          <input
            id={`${id}-${field.key}`}
            className={inputClass}
            value={props.draft[field.key]}
            disabled={props.disabled}
            type={field.min === undefined ? 'text' : 'number'}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            aria-invalid={!!errors[field.key]}
            aria-describedby={`${id}-${field.key}-hint`}
            spellCheck={false}
            onChange={(event) => props.change({ [field.key]: event.target.value })}
            onBlur={props.validate}
          />
          <span id={`${id}-${field.key}-hint`} className="text-xs leading-5 text-muted-foreground">
            {field.hint}
          </span>
          {errors[field.key] && (
            <span role="alert" className="text-xs text-destructive-foreground">
              {errors[field.key]}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
export function invalidSettingsCategory(draft: ProductSettingsDraft): SettingsCategory {
  const errors = draftErrors(draft);
  if (errors.defaultAgent) return 'conversation';
  if (sync.some(({ key }) => errors[key])) return 'sync';
  return 'resources';
}

export function ProductSettingsForm({
  category,
  ...props
}: Props & { category: Exclude<SettingsCategory, 'environment'> }) {
  const id = useId();
  if (category === 'sync')
    return (
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-medium">新工作区同步默认值</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            过滤默认值仅复制到新工作区；已有工作区的规则在各自同步面板修改。
          </p>
        </div>
        <Fields fields={sync} {...props} />
        <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
          自动同步间隔适用于所有工作区；手动同步及执行、保存触发的同步保持不变。
        </p>
      </section>
    );
  if (category === 'resources')
    return (
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-medium">服务器资源采样</h3>
          <p className="text-sm leading-6 text-muted-foreground">设置所有工作区的资源检查频率。</p>
        </div>
        <Fields fields={resources} {...props} />
      </section>
    );
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
        </select>
      </label>
      <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
        默认模型由原生 Agent 配置管理；当前会话需要更换模型时，在消息输入区显式选择。
      </p>
    </section>
  );
}
