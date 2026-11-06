import { Menu, MenuButton, MenuGroup, MenuItem, MenuProvider, MenuSeparator, useMenuStore } from '@ariakit/react';
import { Check, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentCapabilities, AgentKind, AgentModel, Workspace } from '@agentdeck/shared';
import { ApiError, queryKeys } from '../../lib/api';
import { ProjectManageDialog } from '../../app/ProjectManageDialog';
import { buttonClass } from '../../ui/styles';
import { agentUnavailable, agentVersion, useEnvironment } from '../settings/use-environment';
import { sessionActionKey, useChat } from './chat-store';
import { useAgentCapabilities } from './use-agent-capabilities';
import { AgentIcon } from '../../ui/BrandIcons';
import { ManualModelDialog } from './ManualModelDialog';
import { claudeContextModels, findModel, modelDefaultEffort, modelDisplay, modelEfforts } from './model-capabilities';

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
const menuClass =
  'z-50 max-h-[min(440px,var(--popover-available-height))] w-72 overflow-y-auto rounded-2xl border border-border bg-card p-1 text-foreground shadow-lg';
const itemClass =
  'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-border-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-45';
const triggerClass = `${buttonClass('ghost')} min-h-7 min-w-0 gap-1 rounded-lg px-2 text-[13px]`;

function Choice({
  checked,
  disabled,
  choose,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  choose(): void;
  children: ReactNode;
}) {
  return (
    <MenuItem role="menuitemradio" aria-checked={checked} disabled={disabled} onClick={choose} className={itemClass}>
      <Check aria-hidden className={`size-3.5 shrink-0 ${checked ? '' : 'invisible'}`} />
      <span className="min-w-0 flex-1">{children}</span>
    </MenuItem>
  );
}
function CatalogStatus({ catalog }: { catalog: ReturnType<typeof useAgentCapabilities> }) {
  if (catalog.isFetching && !catalog.data?.models.length)
    return (
      <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
        正在加载模型…
      </p>
    );
  if (catalog.isError)
    return (
      <p role="alert" className="px-3 py-2 text-xs leading-5 text-warning">
        {catalog.error instanceof ApiError ? catalog.error.message : '暂时无法读取模型。'}
      </p>
    );
  const data = catalog.data;
  if (!data || data.discovered === false) return null;
  const warning = data.modelWarning ?? data.warnings[0];
  if (warning) return <p className="px-3 py-1 text-xs leading-5 text-warning">{warning}</p>;
  return null;
}
function RefreshModels({ catalog, disabled }: { catalog: ReturnType<typeof useAgentCapabilities>; disabled: boolean }) {
  return (
    <MenuItem
      className={itemClass}
      disabled={disabled || catalog.isFetching}
      hideOnClick={false}
      onClick={catalog.refresh}
      title="重新读取模型"
    >
      <RefreshCw aria-hidden className={`size-3.5 ${catalog.isFetching ? 'motion-safe:animate-spin' : ''}`} />
      {catalog.isError || catalog.data?.modelWarning ? '重试' : '刷新模型列表'}
    </MenuItem>
  );
}

type CatalogProps = { disabled: boolean; catalog: ReturnType<typeof useAgentCapabilities> };
function modelOrigin(model: string, native?: string, actual?: string, configured?: string): string {
  if (model) return `当前覆盖：${model}`;
  if (native) return `原生会话配置：${native}`;
  if (actual) return `最近实际运行：${actual}`;
  return configured ? `原生配置：${configured}` : '沿用原生配置';
}
function inheritedEffort(agent: AgentKind, id: string, catalog?: AgentCapabilities) {
  return catalog?.defaultReasoningEffort ?? modelDefaultEffort(agent, id, catalog?.models ?? []);
}
function inheritedModel(native?: string, actual?: string, configured?: string) {
  return native || actual || configured || '';
}
function useModelPresentation(model: string, catalog?: AgentCapabilities) {
  const agent = useChat((state) => state.agent);
  const actual = useChat((state) => state.actualModel);
  const native = useChat((state) => {
    if (!state.workspaceId || !state.sessionId) return undefined;
    return state.sessionModels[sessionActionKey(state.workspaceId, { agent: state.agent, sessionId: state.sessionId })]
      ?.nativeModel;
  });
  const reading = useChat((state) => state.loadingHistory);
  // 下一轮配置与上一轮实际报告分开；没有配置证据时才以最近报告说明会话。
  const configured = catalog?.defaultModel;
  const inherited = inheritedModel(native, actual, configured);
  const id = model || inherited;
  const models = catalog?.models ?? [];
  const candidate = findModel(models, id);
  const label = reading && !id ? '正在读取型号…' : modelDisplay(id, candidate);
  return {
    id,
    label,
    title: modelOrigin(model, native, actual, configured),
    actual,
    defaultEffort: model ? modelDefaultEffort(agent, id, models) : inheritedEffort(agent, id, catalog),
    inheritedLabel: modelDisplay(inherited, findModel(models, inherited)),
  };
}
function effortLabel(effort: string) {
  return effort || '自动';
}
function ExtendedContextLabel({ label }: { label: string }) {
  if (!/\[1m\]$/i.test(label)) return null;
  return (
    <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4" title="模型使用 [1m] 参数">
      1M
    </span>
  );
}
function AgentChoices({ disabled }: { disabled: boolean }) {
  const agent = useChat((state) => state.agent);
  const historical = useChat((state) => !!state.sessionId);
  const setAgent = useChat((state) => state.setAgent);
  const environment = useEnvironment();
  return (
    <>
      <p className="px-3 py-2 text-xs text-muted-foreground">{historical ? '会话 Agent' : 'Agent'}</p>
      {(['claude', 'codex', 'antigravity'] as const).map((kind) => (
        <Choice key={kind} checked={agent === kind} disabled={disabled || historical} choose={() => setAgent(kind)}>
          <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
            <AgentIcon agent={kind} className="size-3.5 shrink-0" /> {AGENT_LABELS[kind]}
          </span>
        </Choice>
      ))}
      {agentUnavailable(environment.data, agent) && (
        <p role="status" className="px-3 py-2 text-xs leading-5 text-warning">
          当前 Agent 不可用，请在设置中检查。
        </p>
      )}
      <MenuSeparator className="my-1 border-t border-border" />
    </>
  );
}
function ModelActions({ disabled, model, onManual }: { disabled: boolean; model: string; onManual(): void }) {
  const setModel = useChat((state) => state.setModel);
  return (
    <MenuProvider placement="right-start">
      <MenuButton className={itemClass}>
        <span className="flex-1">更多模型操作</span>
        <ChevronRight aria-hidden className="size-3.5" />
      </MenuButton>
      <Menu portal unmountOnHide gutter={8} aria-label="更多模型操作" className={menuClass}>
        <MenuItem className={itemClass} disabled={disabled || !model} onClick={() => setModel('')}>
          清除模型覆盖
        </MenuItem>
        <MenuSeparator className="my-1 border-t border-border" />
        <MenuItem className={itemClass} disabled={disabled} onClick={onManual}>
          手动填写模型
        </MenuItem>
      </Menu>
    </MenuProvider>
  );
}
function ModelChoices({
  disabled,
  catalog,
  model,
  currentModel,
  inheritedLabel,
  onManual,
  onRepair,
}: CatalogProps & { model: string; currentModel: string; inheritedLabel: string; onManual(): void; onRepair(): void }) {
  const setModel = useChat((state) => state.setModel);
  return (
    <>
      <MenuGroup aria-label="可选模型">
        <p className="px-3 py-2 text-xs text-muted-foreground">模型</p>
        <Choice checked={!model} disabled={disabled} choose={() => setModel('')}>
          <span className="block">沿用原生配置</span>
          {inheritedLabel !== '选择模型' && (
            <span className="block truncate text-xs text-muted-foreground">{inheritedLabel}</span>
          )}
        </Choice>
        {catalog.data?.models.map((candidate) => (
          <Choice
            key={candidate.id}
            checked={!!model && findModel(catalog.data.models, model)?.id === candidate.id}
            disabled={disabled}
            choose={() => setModel(candidate.id)}
          >
            <span className="block truncate">{candidate.label}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground" title={candidate.description}>
              {candidate.modelId && candidate.modelId !== candidate.id
                ? `${candidate.id} → ${candidate.modelId}`
                : candidate.id}
            </span>
          </Choice>
        ))}
      </MenuGroup>
      <CatalogStatus catalog={catalog} />
      <ClaudeContextChoices disabled={disabled} model={currentModel} models={catalog.data?.models ?? []} />
      <MenuSeparator className="my-1 border-t border-border" />
      {catalog.error instanceof ApiError && catalog.error.code === 'workspace_directory_unavailable' ? (
        <MenuItem className={itemClass} disabled={disabled} onClick={onRepair}>
          更换工作区目录
        </MenuItem>
      ) : (
        <RefreshModels catalog={catalog} disabled={disabled} />
      )}
      <ModelActions disabled={disabled} model={model} onManual={onManual} />
    </>
  );
}
function ClaudeContextChoices({ disabled, model, models }: { disabled: boolean; model: string; models: AgentModel[] }) {
  const agent = useChat((state) => state.agent);
  const setModel = useChat((state) => state.setModel);
  const effort = useChat((state) => state.reasoningEfforts.claude);
  const setEffort = useChat((state) => state.setReasoningEffort);
  if (agent !== 'claude') return null;
  const choices = claudeContextModels(model, models);
  if (!choices) return null;
  const choose = (id: string) => {
    setModel(id);
    setEffort(effort);
  };
  return (
    <>
      <MenuSeparator className="my-1 border-t border-border" />
      <MenuGroup aria-label="Claude 上下文窗口">
        <p className="px-3 py-2 text-xs text-muted-foreground">上下文窗口</p>
        <div className="grid grid-cols-2 gap-1">
          <Choice checked={!choices.selected} disabled={disabled} choose={() => choose(choices.standard)}>
            默认窗口
          </Choice>
          <Choice checked={choices.selected} disabled={disabled} choose={() => choose(choices.extended)}>
            1M
          </Choice>
        </div>
      </MenuGroup>
    </>
  );
}
function EffortChoices({
  disabled,
  efforts,
  effort,
  defaultEffort,
}: {
  disabled: boolean;
  efforts: string[];
  effort: string;
  defaultEffort?: string;
}) {
  const setEffort = useChat((state) => state.setReasoningEffort);
  return (
    <>
      <p className="px-3 py-2 text-xs text-muted-foreground">推理强度</p>
      {efforts.map((value) => (
        <Choice key={value} checked={effort === value} disabled={disabled} choose={() => setEffort(value)}>
          {value}
        </Choice>
      ))}
      <MenuSeparator className="my-1 border-t border-border" />
      <Choice checked={!effort} disabled={disabled} choose={() => setEffort('')}>
        {defaultEffort ? `沿用配置 · ${defaultEffort}` : '自动'}
      </Choice>
    </>
  );
}

/** 模型菜单只表达下一轮选择，不把候选或覆盖值冒充实际模型报告。 */
export function ModelOptionsMenu({ disabled }: { disabled: boolean }) {
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [repairProject, setRepairProject] = useState<Workspace>();
  const client = useQueryClient();
  const modelMenu = useMenuStore({ open: modelOpen, setOpen: setModelOpen, placement: 'top-end' });
  const effortMenu = useMenuStore({ open: effortOpen, setOpen: setEffortOpen, placement: 'top-end' });
  const agent = useChat((state) => state.agent);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  const effort = useChat((state) => state.reasoningEfforts[state.agent]);
  // 选中会话即读本地缓存；只有首次打开菜单且无缓存时才向 CLI 发现。
  const catalog = useAgentCapabilities(true, modelOpen || effortOpen);
  const presentation = useModelPresentation(model, catalog.data);
  const environment = useEnvironment();
  const version = agentVersion(environment.data, agent);
  const setModel = useChat((state) => state.setModel);
  const models = catalog.data?.models ?? [];
  const efforts = modelEfforts(agent, presentation.id, models);
  return (
    <>
      <MenuButton
        store={modelMenu}
        render={<button type="button" />}
        aria-label="模型选项"
        disabled={disabled}
        className={`${triggerClass} max-w-64`}
        title={`${AGENT_LABELS[agent]}${version ? ` · 本机探测版本 ${version}` : ''} · ${presentation.title} · ${presentation.label}`}
      >
        <AgentIcon agent={agent} className="size-3.5 shrink-0" />
        <span className="truncate">
          {AGENT_LABELS[agent]} · {presentation.label}
        </span>
        <ExtendedContextLabel label={presentation.label} />
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </MenuButton>
      <MenuButton
        store={effortMenu}
        render={<button type="button" />}
        aria-label="推理强度"
        disabled={disabled}
        className={`${triggerClass} max-w-36`}
        title="选择推理强度"
      >
        <span className="truncate">{effortLabel(effort)}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </MenuButton>
      <Menu store={modelMenu} portal unmountOnHide gutter={8} aria-label="模型选项菜单" className={menuClass}>
        <AgentChoices disabled={disabled} />
        <ModelChoices
          disabled={disabled}
          catalog={catalog}
          model={model}
          currentModel={presentation.id}
          inheritedLabel={presentation.inheritedLabel}
          onManual={() => setManual(true)}
          onRepair={() => {
            const project = client
              .getQueryData<Workspace[]>(queryKeys.workspaces)
              ?.find((entry) => entry.id === useChat.getState().workspaceId);
            if (project) setRepairProject(project);
          }}
        />
        {presentation.actual && (
          <p className="px-3 pt-2 pb-1 text-xs leading-5 text-muted-foreground">最近实际运行：{presentation.actual}</p>
        )}
      </Menu>
      <Menu store={effortMenu} portal unmountOnHide gutter={8} aria-label="推理强度菜单" className={menuClass}>
        <EffortChoices
          disabled={disabled}
          efforts={efforts}
          effort={effort}
          defaultEffort={presentation.defaultEffort}
        />
        {!efforts.length && <CatalogStatus catalog={catalog} />}
      </Menu>
      {manual && (
        <ManualModelDialog
          model={model}
          disabled={disabled}
          apply={(value) => {
            setModel(value);
            setManual(false);
          }}
          onClose={() => setManual(false)}
        />
      )}
      {repairProject && (
        <ProjectManageDialog project={repairProject} action="directory" onClose={() => setRepairProject(undefined)} />
      )}
    </>
  );
}
