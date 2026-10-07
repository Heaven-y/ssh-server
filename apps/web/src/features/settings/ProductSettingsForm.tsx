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
const models: Field[] = [
  { key: 'claudeModel', label: 'Claude 默认模型', hint: '留空跟随本机原生配置，最多200字符。' },
  { key: 'codexModel', label: 'Codex 默认模型', hint: '只作用于新会话；留空跟随本机原生配置。' },
];
const sync: Field[] = [
  {
    key: 'maxFileMiB',
    label: '默认单文件上限（MiB）',
    hint: '1字节到100MiB；大数据与权重留在服务器。',
    min: 1 / 1024 / 1024,
    max: 100,
    step: 'any',
  },
  { key: 'extensions', label: '默认排除扩展名', hint: '英文字母或数字，用逗号分隔；.git始终排除。' },
  { key: 'syncInterval', label: '自动同步间隔（秒）', hint: '5–300秒；页面隐藏、忙或待确认时暂停。', min: 5, max: 300 },
];
const resources: Field[] = [
  { key: 'resourceInterval', label: '资源检查间隔（秒）', hint: '2–60秒；页面隐藏时暂停。', min: 2, max: 60 },
  {
    key: 'resourceTimeout',
    label: '资源采样超时（秒）',
    hint: '2–30秒；超时保留最近数据并标明过期。',
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
  if (errors.defaultAgent || models.some(({ key }) => errors[key])) return 'conversation';
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
            过滤默认值仅在新建工作区时复制，不覆盖已有工作区。已有工作区请打开其同步面板，修改「当前工作区同步规则」。
          </p>
        </div>
        <Fields fields={sync} {...props} />
        <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
          自动同步间隔是全局偏好，保存后对已有工作区生效；页面隐藏、忙或待确认时暂停，不触发 AI 分析。
        </p>
      </section>
    );
  if (category === 'resources')
    return (
      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="font-medium">服务器资源采样</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            控制所有工作区的资源检查频率，不改变服务器上的任务。
          </p>
        </div>
        <Fields fields={resources} {...props} />
        <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
          超过15秒或3倍检查间隔（取较大值）标为过期。资源采样独立运行，不调用模型。
        </p>
      </section>
    );
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium">新会话默认值</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          仅作为新会话的初始选择，不覆盖已有会话或正在运行的轮次。
        </p>
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
      <Fields fields={models} {...props} />
      <p className="rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
        历史续接保留原模型；手动填写模型才覆盖。原生 Agent 配置在独立视图中编辑，不与产品偏好混存。
      </p>
    </section>
  );
}
