import { useLayoutEffect, type MutableRefObject } from 'react';
import { ArrowUpRight, FileCode2, RefreshCw, Save } from 'lucide-react';
import type { AgentKind, ModelSettingField } from '@agentdeck/shared';
import { AgentIcon } from '../../ui/BrandIcons';
import { buttonClass } from '../../ui/styles';
import { nativeAgentNames } from './native-resource-labels';
import { ModelSettingsField } from './ModelSettingsField';
import { modelSettingValue, modelSettingsFields, useModelSettings, type SettingsLeave } from './use-model-settings';

type State = ReturnType<typeof useModelSettings>;
function visibleFields(fields: ModelSettingField[], state: State) {
  const auth = fields.find((field) => field.key === 'authMode');
  if (!auth) return fields;
  const mode = modelSettingValue(auth, state.draft);
  return fields.filter((field) => {
    if (field.key === 'envKey') return mode === 'env';
    if (field.key === 'apiKey') return mode === 'token';
    return true;
  });
}
function Fields({ fields, state }: { fields: ModelSettingField[]; state: State }) {
  return fields.map((field) => (
    <ModelSettingsField
      key={field.key}
      field={field}
      value={modelSettingValue(field, state.draft)}
      cleared={state.draft[field.key] === null}
      disabled={state.saving}
      change={(value) => state.change(field, value)}
    />
  ));
}
function ModelSettingsForm({ state }: { state: State }) {
  if (!state.document) return null;
  const fields = modelSettingsFields(state.document, state.draft);
  const models = fields.filter((field) => field.group === 'model');
  const connections = visibleFields(
    fields.filter((field) => field.group === 'connection'),
    state,
  );
  const aliases = models.filter((field) => field.key !== 'model');
  return (
    <div className="space-y-5">
      <section aria-label="模型选择" className="space-y-4">
        <Fields fields={models.filter((field) => field.key === 'model')} state={state} />
        {aliases.length > 0 && (
          <details className="rounded-xl border border-border bg-background/30 px-4 py-3">
            <summary className="cursor-pointer text-[13px] text-muted-foreground">模型别名映射</summary>
            <div className="mt-4 grid gap-4">
              <Fields fields={aliases} state={state} />
            </div>
          </details>
        )}
      </section>
      <section aria-label="服务连接" className="space-y-4 border-t border-border pt-5">
        <h4 className="text-sm font-medium">服务连接</h4>
        <Fields fields={connections} state={state} />
      </section>
    </div>
  );
}
function Feedback({ state }: { state: State }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      )}
      {!state.document && !state.error && (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">
          正在读取原生模型配置…
        </p>
      )}
    </>
  );
}
function ModelSettingsWarnings({ agent, state }: { agent: AgentKind; state: State }) {
  return (
    <>
      {agent === 'antigravity' && (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs leading-6 text-muted-foreground">
          Gemini API 的地址和 Key 由环境变量提供；下方启动环境只用于工作台启动的 agy。 使用 Antigravity 账号时，沿用 agy
          原生登录。
        </div>
      )}
      {!!state.document?.warnings.length && (
        <div className="space-y-1 border-l-2 border-border-strong pl-3 text-xs leading-6 text-muted-foreground">
          {state.document.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </>
  );
}

export function ModelSettingsPanel({
  agent,
  guardRef,
  onNative,
  onLaunchEnvironment,
}: {
  agent: AgentKind;
  guardRef: MutableRefObject<SettingsLeave>;
  onNative(): void;
  onLaunchEnvironment(): void;
}) {
  const state = useModelSettings(agent);
  useLayoutEffect(() => {
    guardRef.current = state.leave;
    return () => {
      guardRef.current = (action) => action();
    };
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2.5 text-lg font-semibold">
            <AgentIcon agent={agent} className="size-5" />
            {nativeAgentNames[agent]}
          </h3>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            使用 CLI 的原生配置，设置会同步供本机 CLI 读取。
          </p>
        </div>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={state.saving}
          aria-label={`修改 ${nativeAgentNames[agent]} 原始配置`}
          onClick={() => state.leave(onNative)}
        >
          <FileCode2 aria-hidden className="size-4" />
          原始配置
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <Feedback state={state} />
        <ModelSettingsForm state={state} />
        <div className="space-y-3">
          <ModelSettingsWarnings agent={agent} state={state} />
          <button
            type="button"
            className={`${buttonClass('ghost')} -ml-3.5`}
            disabled={state.saving}
            onClick={() => state.leave(onLaunchEnvironment)}
          >
            {agent === 'antigravity' ? '配置 API 地址与 Key' : '启动环境与高级认证'}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </button>
        </div>
      </div>
      <footer className="mt-4 shrink-0 space-y-3 border-t border-border pt-4">
        {state.document && (
          <p className="break-all font-mono text-[11px] text-muted-foreground">{state.document.displayPath}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {state.dirty ? '有未保存修改' : '新会话读取最新配置；会话内选择和更高层配置优先。'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={state.saving || (!state.document && !state.error)}
              onClick={state.reread}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              重新读取
            </button>
            <button
              type="button"
              className={buttonClass('primary')}
              disabled={state.saving || !state.dirty}
              onClick={() => void state.save()}
            >
              <Save aria-hidden className="size-3.5" />
              {state.saving ? '正在保存…' : '保存配置'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
