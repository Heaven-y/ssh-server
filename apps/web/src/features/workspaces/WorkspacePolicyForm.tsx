import {
  DEFAULT_POLICY_RULE_IDS,
  DEFAULT_POLICY_RULE_REASONS,
  MAX_CUSTOM_POLICY_RULES,
  type WorkspacePolicy,
  type CustomPolicyRule,
} from '@ssh-server/shared';
import type { Dispatch, SetStateAction } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { buttonClass, inputClass } from '../../ui/styles';

export type PolicyFieldError = { path: string; message: string };
type Props = {
  draft: WorkspacePolicy;
  setDraft: Dispatch<SetStateAction<WorkspacePolicy | undefined>>;
  errors: PolicyFieldError[];
  prefix: string;
};
function RuleField({
  field,
  index,
  rule,
  prefix,
  errors,
  update,
}: {
  field: 'pattern' | 'reason';
  index: number;
  rule: CustomPolicyRule;
  prefix: string;
  errors: PolicyFieldError[];
  update(patch: Partial<CustomPolicyRule>): void;
}) {
  const key = `customRules.${index}.${field}`;
  const error = errors.find((item) => item.path === key);
  const id = `${prefix}-${key}`;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id}>
        {field === 'reason' ? '拒绝原因' : rule.kind === 'program' ? '程序名' : '命令包含的字符串'}
      </label>
      <input
        id={id}
        value={rule[field]}
        maxLength={field === 'reason' ? 160 : 256}
        className={inputClass}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => update({ [field]: event.target.value })}
      />
      {error && (
        <span id={`${id}-error`} className="text-destructive-foreground">
          {error.message}
        </span>
      )}
    </div>
  );
}

export function WorkspacePolicyForm({ draft, setDraft, errors, prefix }: Props) {
  const custom = draft.customRules ?? [];
  const update = (index: number, patch: Partial<CustomPolicyRule>) =>
    setDraft(
      (current) =>
        current && {
          ...current,
          customRules: (current.customRules ?? []).map((rule, position) =>
            position === index ? { ...rule, ...patch } : rule,
          ),
        },
    );
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={`${prefix}-defaults`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`${prefix}-defaults`} className="font-medium">
            默认规则
          </h3>
          <button
            type="button"
            className={buttonClass('ghost')}
            onClick={() => setDraft((current) => current && { ...current, disabledRules: [] })}
          >
            <RotateCcw aria-hidden className="size-4" />
            恢复默认规则
          </button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          勾选表示启用。恢复默认规则会重新启用全部默认项，保留自定义规则。
        </p>
        {DEFAULT_POLICY_RULE_IDS.map((ruleId) => (
          <label
            key={ruleId}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={!draft.disabledRules?.includes(ruleId)}
              onChange={(event) => {
                const enabled = event.target.checked;
                setDraft(
                  (current) =>
                    current && {
                      ...current,
                      disabledRules: enabled
                        ? (current.disabledRules ?? []).filter((id) => id !== ruleId)
                        : [...(current.disabledRules ?? []), ruleId],
                    },
                );
              }}
            />
            <span>{DEFAULT_POLICY_RULE_REASONS[ruleId]}</span>
          </label>
        ))}
      </section>
      <section aria-labelledby={`${prefix}-custom`} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`${prefix}-custom`} className="font-medium">
            自定义规则（{custom.length}/{MAX_CUSTOM_POLICY_RULES}）
          </h3>
          <button
            type="button"
            className={buttonClass()}
            disabled={custom.length >= MAX_CUSTOM_POLICY_RULES}
            onClick={() =>
              setDraft(
                (current) =>
                  current && {
                    ...current,
                    customRules: [
                      ...(current.customRules ?? []),
                      { id: `custom-${crypto.randomUUID()}`, kind: 'program', pattern: '', reason: '' },
                    ],
                  },
              )
            }
          >
            <Plus aria-hidden className="size-4" />
            追加规则
          </button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          区分大小写，不支持正则。程序名会忽略目录与包装命令；字符串可命中引号内文字和参数。
        </p>
        {custom.length === 0 && <p className="text-sm text-muted-foreground">尚无自定义规则。</p>}
        {custom.map((rule, index) => (
          <div key={rule.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                <span className="shrink-0 whitespace-nowrap">匹配方式</span>
                <select
                  aria-label={`规则${index + 1}匹配方式`}
                  className={inputClass}
                  value={rule.kind}
                  onChange={(event) => update(index, { kind: event.target.value as CustomPolicyRule['kind'] })}
                >
                  <option value="program">程序名</option>
                  <option value="contains">命令包含字符串</option>
                </select>
              </label>
              <button
                type="button"
                className={buttonClass('ghost')}
                aria-label={`移除规则${index + 1}`}
                onClick={() =>
                  setDraft(
                    (current) =>
                      current && {
                        ...current,
                        customRules: (current.customRules ?? []).filter((item) => item.id !== rule.id),
                      },
                  )
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
            <RuleField
              field="pattern"
              index={index}
              rule={rule}
              prefix={prefix}
              errors={errors}
              update={(patch) => update(index, patch)}
            />
            <RuleField
              field="reason"
              index={index}
              rule={rule}
              prefix={prefix}
              errors={errors}
              update={(patch) => update(index, patch)}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
