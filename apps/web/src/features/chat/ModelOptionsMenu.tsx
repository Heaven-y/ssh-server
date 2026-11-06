import { AGENT_LABELS } from '../../cli/shared/labels';
import { MenuChoice as Choice, modelMenuItemClass as itemClass } from '../../ui/MenuChoice';
import { ClaudeContextChoices } from '../../cli/claude/ContextChoices';
import { ApiError } from '../../lib/http';
import { projectsKeys } from '../projects/api';
import { Menu, MenuButton, MenuGroup, MenuItem, MenuProvider, MenuSeparator, useMenuStore } from '@ariakit/react';
import { ChevronDown, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentCapabilities, AgentKind } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';

import { ProjectManageDialog } from '../projects/ProjectManageDialog';
import { buttonClass } from '../../ui/styles';
import { agentUnavailable, useEnvironment } from '../settings/use-environment';
import { sessionActionKey, useChat } from './chat-store';
import { useAgentCapabilities } from './use-agent-capabilities';
import { AgentIcon } from '../../ui/BrandIcons';
import { ManualModelDialog } from './ManualModelDialog';
import { findModel, modelDisplay } from '../../cli/shared/model-identity';
import { configuredModelEffort, modelEfforts } from '../../cli/model-capabilities';
import { ModelCandidateLabel } from './ModelCandidateLabel';
import { ModelSearchDialog } from './ModelSearchDialog';
import { modelCandidates } from './model-candidates';

const menuClass =
  'z-50 max-h-[min(440px,var(--popover-available-height))] w-72 overflow-y-auto rounded-2xl border border-border bg-card p-1 text-foreground shadow-lg';
const triggerClass = `${buttonClass('ghost')} min-h-7 min-w-0 gap-1 rounded-lg px-2 text-[13px]`;

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
function inheritedModel(native?: string, actual?: string, configured?: string) {
  return native || actual || configured || '';
}
function useModelPresentation(model: string, catalog: AgentCapabilities | undefined, fetching: boolean) {
  const agent = useChat((state) => state.agent);
  const actual = useChat((state) => state.actualModel);
  const native = useChat((state) => {
    if (!state.workspaceId || !state.sessionId) return undefined;
    return state.sessionModels[sessionActionKey(state.workspaceId, { agent: state.agent, sessionId: state.sessionId })]
      ?.nativeModel;
  });
  const reading = useChat((state) => state.loadingHistory);
  const historical = useChat((state) => !!state.sessionId);
  // 下一轮配置与上一轮实际报告分开；没有配置证据时才以最近报告说明会话。
  const configured = catalog?.defaultModel;
  const inherited = inheritedModel(native, actual, configured);
  const id = model || inherited;
  const models = catalog?.models ?? [];
  const candidate = findModel(models, id);
  return {
    id,
    label: modelDisplay(id, candidate),
    loading: !id && (reading || fetching),
    title: modelOrigin(model, native, actual, configured),
    actual,
    // 旧会话未报告原生强度，不能用新会话的目录默认冒充其有效值。
    defaultEffort: historical ? undefined : configuredModelEffort(agent, id, catalog),
  };
}
function effortLabel(effort?: string) {
  return effort === 'auto' ? '自动' : effort || '跟随配置';
}
function ExtendedContextLabel({ label }: { label: string }) {
  if (!/\[1m\]$/i.test(label)) return null;
  return (
    <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4" title="模型使用 [1m] 参数">
      1M
    </span>
  );
}
function ModelButtonContent({ agent, label, loading }: { agent: AgentKind; label: string; loading: boolean }) {
  return (
    <>
      <AgentIcon agent={agent} className="size-3.5 shrink-0" />
      {label && <span className="truncate">{label}</span>}
      {loading && <LoaderCircle aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />}
      <ExtendedContextLabel label={label} />
      <ChevronDown aria-hidden className="size-3.5 shrink-0" />
    </>
  );
}
function AgentChoices({ disabled }: { disabled: boolean }) {
  const agent = useChat((state) => state.agent);
  const historical = useChat((state) => !!state.sessionId);
  const setAgent = useChat((state) => state.setAgent);
  const environment = useEnvironment();
  return (
    <>
      <MenuGroup aria-label="CLI" className="flex items-center gap-1 px-2 py-1">
        {(['claude', 'codex', 'antigravity'] as const).map((kind) => (
          <MenuItem
            key={kind}
            role="menuitemradio"
            aria-checked={agent === kind}
            aria-label={AGENT_LABELS[kind]}
            title={AGENT_LABELS[kind]}
            disabled={disabled || historical}
            onClick={() => setAgent(kind)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none data-active-item:ring-1 data-active-item:ring-border-strong aria-checked:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          >
            <AgentIcon agent={kind} className="size-4" />
          </MenuItem>
        ))}
      </MenuGroup>
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
  onManual,
  onSearch,
  onRepair,
}: CatalogProps & {
  model: string;
  currentModel: string;
  onManual(): void;
  onSearch(): void;
  onRepair(): void;
}) {
  const setModel = useChat((state) => state.setModel);
  const agent = useChat((state) => state.agent);
  const effort = useChat((state) => state.reasoningEfforts[state.agent]);
  const setEffort = useChat((state) => state.setReasoningEffort);
  const models = catalog.data?.models ?? [];
  const candidates = modelCandidates(models, currentModel);
  const selected = findModel(candidates, currentModel)?.id;
  return (
    <>
      <MenuGroup aria-label="可选模型">
        <p className="px-3 py-2 text-xs text-muted-foreground">模型</p>
        {candidates.slice(0, 20).map((candidate) => (
          <Choice
            key={candidate.id}
            checked={selected === candidate.id}
            disabled={disabled}
            choose={() => setModel(candidate.id)}
          >
            <ModelCandidateLabel model={candidate} />
          </Choice>
        ))}
      </MenuGroup>
      {candidates.length > 20 && (
        <MenuItem className={itemClass} disabled={disabled} onClick={onSearch}>
          搜索全部模型
        </MenuItem>
      )}
      <CatalogStatus catalog={catalog} />
      {agent === 'claude' && (
        <ClaudeContextChoices
          disabled={disabled}
          model={currentModel}
          models={models}
          choose={(id) => {
            setModel(id);
            setEffort(effort);
          }}
        />
      )}
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
          {effortLabel(value)}
        </Choice>
      ))}
      <MenuSeparator className="my-1 border-t border-border" />
      <Choice checked={!effort} disabled={disabled} choose={() => setEffort('')}>
        {defaultEffort ? `跟随配置 · ${effortLabel(defaultEffort)}` : '跟随配置'}
      </Choice>
    </>
  );
}

function EffortControls({
  disabled,
  catalog,
  model,
  defaultEffort,
  store,
}: CatalogProps & { model: string; defaultEffort?: string; store: ReturnType<typeof useMenuStore> }) {
  const agent = useChat((state) => state.agent);
  const effort = useChat((state) => state.reasoningEfforts[state.agent]);
  const setEffort = useChat((state) => state.setReasoningEffort);
  const models = catalog.data?.models ?? [];
  const unsupported = findModel(models, model)?.reasoningEfforts?.length === 0;
  const efforts = modelEfforts(agent, model, models);
  useEffect(() => {
    if (!unsupported) return;
    store.setOpen(false);
    if (!disabled && effort) setEffort('');
  }, [unsupported, disabled, effort, setEffort, store]);
  if (unsupported) return null;
  return (
    <>
      <MenuButton
        store={store}
        render={<button type="button" />}
        aria-label="推理强度"
        disabled={disabled}
        className={`${triggerClass} max-w-36`}
        title="选择推理强度"
      >
        <span className="truncate">{effortLabel(effort || defaultEffort)}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </MenuButton>
      <Menu store={store} portal unmountOnHide gutter={8} aria-label="推理强度菜单" className={menuClass}>
        <EffortChoices disabled={disabled} efforts={efforts} effort={effort} defaultEffort={defaultEffort} />
        {!efforts.length && <CatalogStatus catalog={catalog} />}
      </Menu>
    </>
  );
}

/** 模型菜单只表达下一轮选择，不把候选或覆盖值冒充实际模型报告。 */
export function ModelOptionsMenu({ disabled }: { disabled: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const [repairProject, setRepairProject] = useState<Workspace>();
  const client = useQueryClient();
  const modelMenu = useMenuStore({ open: modelOpen, setOpen: setModelOpen, placement: 'top-end' });
  const effortMenu = useMenuStore({ open: effortOpen, setOpen: setEffortOpen, placement: 'top-end' });
  const agent = useChat((state) => state.agent);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  // 选中会话即读本地缓存；只有首次打开菜单且无缓存时才向 CLI 发现。
  const catalog = useAgentCapabilities(true, modelOpen || effortOpen);
  const presentation = useModelPresentation(model, catalog.data, catalog.isFetching);
  const setModel = useChat((state) => state.setModel);
  const models = catalog.data?.models ?? [];
  return (
    <>
      <MenuButton
        store={modelMenu}
        ref={trigger}
        render={<button type="button" />}
        aria-label="模型选项"
        aria-busy={presentation.loading}
        disabled={disabled}
        className={`${triggerClass} max-w-64`}
        title={[AGENT_LABELS[agent], presentation.label, presentation.title].filter(Boolean).join(' · ')}
      >
        <ModelButtonContent agent={agent} label={presentation.label} loading={presentation.loading} />
      </MenuButton>
      <EffortControls
        store={effortMenu}
        disabled={disabled}
        catalog={catalog}
        model={presentation.id}
        defaultEffort={presentation.defaultEffort}
      />
      <Menu store={modelMenu} portal unmountOnHide gutter={8} aria-label="模型选项菜单" className={menuClass}>
        <AgentChoices disabled={disabled} />
        <ModelChoices
          disabled={disabled}
          catalog={catalog}
          model={model}
          currentModel={presentation.id}
          onManual={() => setManual(true)}
          onSearch={() => setSearchOpen(true)}
          onRepair={() => {
            const project = client
              .getQueryData<Workspace[]>(projectsKeys.workspaces)
              ?.find((entry) => entry.id === useChat.getState().workspaceId);
            if (project) setRepairProject(project);
          }}
        />
        {presentation.actual && (
          <p className="px-3 pt-2 pb-1 text-xs leading-5 text-muted-foreground">最近实际运行：{presentation.actual}</p>
        )}
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
      {searchOpen && (
        <ModelSearchDialog
          models={modelCandidates(models, presentation.id)}
          current={presentation.id}
          disabled={disabled}
          choose={(id) => {
            setModel(id);
            closeSearch();
          }}
          close={closeSearch}
        />
      )}
      {repairProject && (
        <ProjectManageDialog project={repairProject} action="directory" onClose={() => setRepairProject(undefined)} />
      )}
    </>
  );
}
