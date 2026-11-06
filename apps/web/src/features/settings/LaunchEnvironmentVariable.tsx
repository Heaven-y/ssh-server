import type { LaunchEnvironmentDocument, LaunchVariableMode } from '@agentdeck/shared/settings';
import { inputClass } from '../../ui/styles';

export type LaunchVariable = LaunchEnvironmentDocument['variables'][number];
export type LaunchVariableDraft = { mode: LaunchVariableMode; value: string };
export type LaunchDraft = Record<string, LaunchVariableDraft>;
const sourceNames = {
  inherited: '继承进程环境',
  configured: '工作台设置',
  disabled: '已停用',
  unset: '未设置',
} as const;

export function invalidLaunchDraft(document: LaunchEnvironmentDocument, draft: LaunchDraft) {
  return document.variables.some((variable) => {
    const value = draft[variable.name];
    if (!value || value.mode !== 'set') return false;
    if (!value.value) return variable.mode !== 'set' || !variable.hasValue;
    return /[\r\n\0]/.test(value.value) || (variable.sensitive && !document.encryptionAvailable);
  });
}

type VariableProps = {
  variable: LaunchVariable;
  draft?: LaunchVariableDraft;
  encryptionAvailable: boolean;
  disabled: boolean;
  change(patch: Partial<LaunchVariableDraft>): void;
};
export function LaunchEnvironmentVariable({ variable, draft, encryptionAvailable, disabled, change }: VariableProps) {
  const mode = draft?.mode ?? variable.mode;
  const secretUnavailable = variable.sensitive && !encryptionAvailable;
  return (
    <section className="space-y-3 border-b border-border py-4 last:border-b-0" aria-label={variable.label}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{variable.label}</h3>
          <p className="break-all font-mono text-[11px] text-muted-foreground">{variable.name}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {sourceNames[variable.source]}
        </span>
      </div>
      <label className="block space-y-1 text-sm">
        <select
          className={`${inputClass} max-w-sm`}
          aria-label={`${variable.label}模式`}
          value={mode}
          disabled={disabled}
          onChange={(event) => change({ mode: event.target.value as LaunchVariableMode, value: '' })}
        >
          <option value="inherit">继承 CLI 启动时的环境</option>
          <option value="set" disabled={secretUnavailable}>
            在工作台中单独设置
          </option>
          <option value="disabled">停用此变量</option>
        </select>
      </label>
      {mode === 'set' && (
        <LaunchVariableValue
          variable={variable}
          draft={draft}
          encryptionAvailable={encryptionAvailable}
          disabled={disabled}
          change={change}
        />
      )}
      {mode === 'disabled' && <p className="text-xs text-muted-foreground">启动该 CLI 时移除此变量，包括继承的值。</p>}
    </section>
  );
}

function LaunchVariableValue({ variable, draft, encryptionAvailable, disabled, change }: VariableProps) {
  const retainsValue = variable.mode === 'set' && variable.hasValue;
  const secretUnavailable = variable.sensitive && !encryptionAvailable;
  return (
    <label className="block space-y-1 text-sm">
      <span>新值</span>
      <input
        type={variable.sensitive ? 'password' : 'text'}
        className={inputClass}
        aria-label={`${variable.label}新值`}
        autoComplete="off"
        spellCheck={false}
        maxLength={4096}
        value={draft?.value ?? ''}
        disabled={disabled || secretUnavailable}
        placeholder={retainsValue ? '留空保留已保存的值，填写以替换' : '填写新的值'}
        onChange={(event) => change({ value: event.target.value })}
      />
      <span className="block text-xs leading-5 text-muted-foreground">
        {retainsValue ? '已有值不会回填。恢复继承会移除工作台保存的值。' : '单独设置需要填写新值。'}
      </span>
    </label>
  );
}
