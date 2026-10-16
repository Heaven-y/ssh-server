import {
  DEFAULT_POLICY_RULE_IDS,
  DEFAULT_POLICY_RULE_REASONS,
  MAX_CUSTOM_POLICY_RULES,
  type WorkspacePolicy,
  type CustomPolicyRule,
} from '@ssh-server/shared';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
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

function PolicyRuleHelp() {
  return (
    <div className="space-y-3 rounded-md bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
      <p>追加规则后，选择匹配方式并填写拒绝原因，保存生效。</p>
      <dl className="space-y-2">
        <div>
          <dt className="font-medium text-foreground">程序名（program）</dt>
          <dd>
            填写 <code>scancel</code> 等程序基本名，不含路径或参数；拒绝原因可写“作业取消由我在终端确认”。
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">命令包含字符串（contains）</dt>
          <dd>
            填写 <code>--purge-cache</code>，可拦截包含该字面串的命令，如 cleanup-tool --purge-cache。
          </dd>
        </div>
      </dl>
      <p>区分大小写，不支持正则或通配符。程序名按基本名比较；包含字符串为字面匹配，引号内文字也可能命中并误拦。</p>
    </div>
  );
}

export function WorkspacePolicyForm({ draft, setDraft, errors, prefix }: Props) {
  const custom = draft.customRules ?? [];
  const [customOpen, setCustomOpen] = useState(false);
  const customError = errors.find((error) => error.path.startsWith('customRules'))?.path;
  const expanded = customOpen || !!customError;
  useEffect(() => {
    if (!customError) return;
    // 等错误摘要完成焦点提示后，将焦点定位到已展开的具体字段。
    const frame = requestAnimationFrame(() => {
      // 用户修正最后一个错误后仍保持展开，避免输入中途失焦。
      setCustomOpen(true);
      const field = document.getElementById(`${prefix}-${customError}`);
      (field ?? document.getElementById(`${prefix}-custom-fields`))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [customError, prefix]);
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
        <p className="text-xs leading-5 text-muted-foreground">恢复默认规则会启用全部默认项，保留自定义规则。</p>
        {(draft.disabledRules?.length ?? 0) > 0 && (
          <p className="text-sm text-warning">部分默认保护已关闭，相应命令不再拦截。</p>
        )}
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
        <h3 id={`${prefix}-custom`}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${prefix}-custom-fields`}
            disabled={!!customError}
            onClick={() => setCustomOpen(!expanded)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left font-medium hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span>
              高级：自定义拦截
              <span className="ml-2 text-sm font-normal text-muted-foreground">（可选 · {custom.length} 条）</span>
            </span>
            <ChevronDown aria-hidden className={`size-4 shrink-0 ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </h3>
        <div id={`${prefix}-custom-fields`} hidden={!expanded} tabIndex={-1}>
          <div className="flex flex-col gap-3">
            <PolicyRuleHelp />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                自定义规则（{custom.length}/{MAX_CUSTOM_POLICY_RULES}）
              </p>
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
          </div>
        </div>
      </section>
    </div>
  );
}
