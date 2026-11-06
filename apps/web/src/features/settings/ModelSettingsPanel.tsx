import { useLayoutEffect, type MutableRefObject } from 'react';
import { ArrowUpRight, FileCode2, RefreshCw } from 'lucide-react';
import type { AgentKind, ModelSettingField } from '@agentdeck/shared';
import { AgentIcon } from '../../ui/BrandIcons';
import { buttonClass } from '../../ui/styles';
import { nativeAgentNames } from './native-resource-labels';
import { ModelSettingsField } from './ModelSettingsField';
import { modelSettingValue, modelSettingsFields, useModelSettings, type SettingsLeave } from './use-model-settings';
import { modelEfforts } from '../chat/model-capabilities';

type State = ReturnType<typeof useModelSettings>;
function visibleFields(fields: ModelSettingField[], state: State) {
  const auth = fields.find((field) => field.key === 'authMode');
  if (!auth) return fields;
  const mode = modelSettingValue(auth, state.draft);
  return fields.filter((field) => {
    if (field.key === 'envKey') return mode === 'env';
    if (field.key === 'apiKey') return mode !== 'command';
    return true;
  });
}
function suggestionsFor(field: ModelSettingField, state: State) {
  const models = state.modelCatalog?.models ?? [];
  if (field.key === 'model') return models.map((model) => ({ value: model.id, label: model.label }));
  if (field.key !== 'reasoningEffort' || field.options) return undefined;
  const selected = state.document?.fields.find((entry) => entry.key === 'model');
  const modelId = selected && modelSettingValue(selected, state.draft);
  return state.document && modelId
    ? modelEfforts(state.document.agent, modelId, models).map((value) => ({ value, label: value }))
    : undefined;
}
function FetchModels({ state }: { state: State }) {
  const hasCatalog = state.modelCatalog && state.modelCatalog.discovered !== false;
  const label = state.dirty ? '保存并获取模型' : hasCatalog ? '重新获取' : '获取模型';
  return (
    <button
      type="button"
      className={`${buttonClass('outline')} shrink-0 rounded-lg`}
      disabled={state.saving || state.modelsLoading}
      onClick={() => void state.fetchModels()}
    >
      <RefreshCw aria-hidden className={`size-3.5 ${state.modelsLoading ? 'motion-safe:animate-spin' : ''}`} />
      {state.modelsLoading ? '正在获取…' : label}
    </button>
  );
}
function Fields({ fields, state }: { fields: ModelSettingField[]; state: State }) {
  return fields.map((field) => (
    <ModelSettingsField
      key={field.key}
      field={field}
      value={modelSettingValue(field, state.draft)}
      cleared={state.draft[field.key] === null}
      disabled={state.saving || state.modelsLoading}
      change={(value) => state.change(field, value)}
      suggestions={suggestionsFor(field, state)}
      action={field.key === 'model' ? <FetchModels state={state} /> : undefined}
    />
  ));
}
function ConnectionFields({ fields, state }: { fields: ModelSettingField[]; state: State }) {
  const paired =
    fields.some((field) => field.key === 'provider') && fields.some((field) => field.key === 'displayName');
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.key}
          className={paired && ['provider', 'displayName'].includes(field.key) ? 'min-w-0' : 'min-w-0 sm:col-span-2'}
        >
          <Fields fields={[field]} state={state} />
        </div>
      ))}
    </div>
  );
}
function ModelSettingsForm({ state, fields }: { state: State; fields: ModelSettingField[] }) {
  const connections = fields.filter((field) => !field.advanced && field.group === 'connection');
  const models = fields.filter((field) => !field.advanced && field.group === 'model');
  const parameters = models.filter((field) =>
    ['reasoningEffort', 'contextWindow', 'autoCompactTokenLimit'].includes(field.key),
  );
  return (
    <div className="space-y-6">
      {connections.length > 0 && (
        <section aria-label="服务连接" className="space-y-3.5">
          <h4 className="text-xs font-medium text-muted-foreground">服务连接</h4>
          <ConnectionFields fields={connections} state={state} />
        </section>
      )}
      <section aria-label="模型选择" className="space-y-3.5 border-t border-border pt-5">
        <h4 className="text-xs font-medium text-muted-foreground">模型</h4>
        <Fields fields={models.filter((field) => !parameters.includes(field))} state={state} />
        {state.modelsError && (
          <p role="alert" className="text-xs leading-5 text-destructive-foreground">
            {state.modelsError}
          </p>
        )}
        {state.modelMessage && (
          <p role="status" className="text-xs text-muted-foreground">
            {state.modelMessage}
          </p>
        )}
        {parameters.length > 0 && (
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Fields fields={parameters} state={state} />
          </div>
        )}
      </section>
    </div>
  );
}
function AdvancedSettings({
  state,
  fields,
  onNative,
  onLaunchEnvironment,
}: {
  state: State;
  fields: ModelSettingField[];
  onNative(): void;
  onLaunchEnvironment?: () => void;
}) {
  return (
    <details className="border-t border-border pt-4">
      <summary className="cursor-pointer text-[13px] text-muted-foreground">高级设置</summary>
      <div className="mt-4 space-y-4">
        <Fields fields={fields.filter((field) => field.advanced)} state={state} />
        {state.document?.warnings.map((warning) => (
          <p key={warning} className="text-xs leading-5 text-muted-foreground">
            {warning}
          </p>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={state.saving || state.modelsLoading}
            aria-label={`修改 ${nativeAgentNames[state.document!.agent]} 原始配置`}
            onClick={() => state.leave(onNative)}
          >
            <FileCode2 aria-hidden className="size-3.5" />
            原始配置
          </button>
          {onLaunchEnvironment && (
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={state.saving || state.modelsLoading}
              onClick={() => state.leave(onLaunchEnvironment)}
            >
              启动环境
              <ArrowUpRight aria-hidden className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={state.saving || state.modelsLoading}
            onClick={state.reread}
          >
            重新读取配置
          </button>
        </div>
        <p className="break-all font-mono text-[11px] text-muted-foreground">{state.document?.displayPath}</p>
      </div>
    </details>
  );
}

function SettingsFeedback({ state }: { state: State }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        {state.error}
      </p>
    );
  if (!state.document)
    return (
      <p role="status" className="py-12 text-center text-sm text-muted-foreground">
        正在读取配置…
      </p>
    );
  return null;
}
function SettingsFooter({ state }: { state: State }) {
  return (
    <footer className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border pt-4">
      <p role={state.message ? 'status' : undefined} className="min-w-0 text-xs text-muted-foreground">
        {state.message || (state.dirty ? '有未保存修改' : '对新会话生效')}
      </p>
      <div className="flex shrink-0 gap-2">
        {!state.document && state.error && (
          <button type="button" className={buttonClass('ghost')} disabled={state.saving} onClick={state.reread}>
            重试
          </button>
        )}
        <button
          type="button"
          className={`${buttonClass('primary')} rounded-lg`}
          disabled={state.saving || state.modelsLoading || !state.dirty}
          onClick={() => void state.save()}
        >
          {state.saving ? '正在保存…' : '保存配置'}
        </button>
      </div>
    </footer>
  );
}

export function ModelSettingsPanel({
  agent,
  projectId,
  guardRef,
  onNative,
  onLaunchEnvironment,
}: {
  agent: AgentKind;
  projectId?: string;
  guardRef: MutableRefObject<SettingsLeave>;
  onNative(): void;
  onLaunchEnvironment?: () => void;
}) {
  const state = useModelSettings(agent, projectId);
  const fields = state.document ? visibleFields(modelSettingsFields(state.document, state.draft), state) : [];
  useLayoutEffect(() => {
    guardRef.current = state.leave;
    return () => {
      guardRef.current = (action) => action();
    };
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-5 shrink-0">
        <h3 className="flex items-center gap-2.5 text-base font-semibold">
          <AgentIcon agent={agent} className="size-5" />
          {nativeAgentNames[agent]}
        </h3>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-1 pr-4 [scrollbar-gutter:stable]">
        <SettingsFeedback state={state} />
        {state.document && (
          <>
            <ModelSettingsForm state={state} fields={fields} />
            <AdvancedSettings
              state={state}
              fields={fields}
              onNative={onNative}
              onLaunchEnvironment={onLaunchEnvironment}
            />
          </>
        )}
      </div>
      <SettingsFooter state={state} />
    </div>
  );
}
