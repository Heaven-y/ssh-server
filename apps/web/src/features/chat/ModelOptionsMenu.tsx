import { Menu, MenuButton, MenuItem, MenuSeparator, useMenuStore } from '@ariakit/react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AgentKind, AgentModel } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { agentUnavailable, useEnvironment } from '../settings/use-environment';
import { useChat } from './chat-store';
import { useAgentCapabilities } from './use-agent-capabilities';
import { ManualModelDialog } from './ManualModelDialog';

export const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };
const STANDARD_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const menuClass =
  'z-50 max-h-[min(440px,var(--popover-available-height))] w-72 overflow-y-auto rounded-xl border border-border-strong bg-card p-1.5 text-foreground shadow-xl';
const itemClass =
  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-45';
const triggerClass = `${buttonClass('ghost')} min-w-0 gap-1 rounded-full px-2 text-xs`;

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
  return (
    <>
      {catalog.isFetching && (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          正在加载模型…
        </p>
      )}
      {catalog.isError && (
        <p role="alert" className="px-3 py-2 text-xs leading-5 text-warning">
          模型列表加载失败，请刷新重试。
        </p>
      )}
      {catalog.data?.warnings.map((warning, index) => (
        <p key={index} className="px-3 py-1 text-xs leading-5 text-warning">
          {warning}
        </p>
      ))}
    </>
  );
}
function RefreshModels({ catalog }: { catalog: ReturnType<typeof useAgentCapabilities> }) {
  return (
    <MenuItem
      className={itemClass}
      disabled={catalog.isFetching}
      hideOnClick={false}
      onClick={() => void catalog.refetch()}
    >
      <RefreshCw aria-hidden className="size-3.5" />
      刷新模型列表
    </MenuItem>
  );
}

type CatalogProps = { disabled: boolean; catalog: ReturnType<typeof useAgentCapabilities> };
function modelLabel(agent: AgentKind, model: string, historical: boolean) {
  return `${AGENT_LABELS[agent]} · ${model || (historical ? '会话模型' : '默认模型')}`;
}
function AgentChoices({ disabled }: { disabled: boolean }) {
  const agent = useChat((state) => state.agent);
  const historical = useChat((state) => !!state.sessionId);
  const setAgent = useChat((state) => state.setAgent);
  const environment = useEnvironment();
  return (
    <>
      <p className="px-3 py-2 text-xs text-muted-foreground">{historical ? '会话 Agent' : 'Agent'}</p>
      {(['claude', 'codex'] as const).map((kind) => (
        <Choice
          key={kind}
          checked={agent === kind}
          disabled={disabled || historical || agentUnavailable(environment.data, kind)}
          choose={() => setAgent(kind)}
        >
          {AGENT_LABELS[kind]}
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
function ModelChoices({
  disabled,
  catalog,
  model,
  historical,
  onManual,
}: CatalogProps & { model: string; historical: boolean; onManual(): void }) {
  const setModel = useChat((state) => state.setModel);
  return (
    <>
      <p className="px-3 py-2 text-xs text-muted-foreground">模型</p>
      <Choice checked={!model} disabled={disabled} choose={() => setModel('')}>
        {historical ? '沿用会话模型' : '默认模型'}
      </Choice>
      {catalog.data?.models.map((candidate) => (
        <Choice
          key={candidate.id}
          checked={model === candidate.id}
          disabled={disabled}
          choose={() => setModel(candidate.id)}
        >
          <span className="block truncate">{candidate.label}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground" title={candidate.description}>
            {candidate.id}
          </span>
        </Choice>
      ))}
      <CatalogStatus catalog={catalog} />
      <MenuSeparator className="my-1 border-t border-border" />
      <MenuItem className={itemClass} disabled={disabled} onClick={onManual}>
        手动填写模型
      </MenuItem>
      <RefreshModels catalog={catalog} />
    </>
  );
}
function EffortChoices({
  disabled,
  agent,
  selected,
  effort,
}: {
  disabled: boolean;
  agent: AgentKind;
  selected?: AgentModel;
  effort: string;
}) {
  const setEffort = useChat((state) => state.setReasoningEffort);
  const nativeEfforts = agent === 'codex' ? (selected?.reasoningEfforts ?? []) : [];
  const efforts = [...new Set([...STANDARD_EFFORTS, ...nativeEfforts])];
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
        自动
      </Choice>
    </>
  );
}

/** 模型菜单只表达下一轮选择，不把候选或覆盖值冒充实际模型报告。 */
export function ModelOptionsMenu({ disabled }: { disabled: boolean }) {
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const modelMenu = useMenuStore({ open: modelOpen, setOpen: setModelOpen, placement: 'top-end' });
  const effortMenu = useMenuStore({ open: effortOpen, setOpen: setEffortOpen, placement: 'top-end' });
  const agent = useChat((state) => state.agent);
  const historical = useChat((state) => !!state.sessionId);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  const effort = useChat((state) => state.reasoningEfforts[state.agent]);
  const setModel = useChat((state) => state.setModel);
  const catalog = useAgentCapabilities(modelOpen || effortOpen);
  const models = catalog.data?.models ?? [];
  const selected = models.find((candidate) => candidate.id === model);
  return (
    <>
      <MenuButton
        store={modelMenu}
        render={<button type="button" />}
        aria-label="模型选项"
        disabled={disabled}
        className={`${triggerClass} max-w-56`}
        title="选择模型"
      >
        <span className="truncate">{modelLabel(agent, model, historical)}</span>
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
        <span className="truncate">{effort || '自动'}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </MenuButton>
      <Menu store={modelMenu} portal unmountOnHide gutter={8} aria-label="模型选项菜单" className={menuClass}>
        <AgentChoices disabled={disabled} />
        <ModelChoices
          disabled={disabled}
          catalog={catalog}
          model={model}
          historical={historical}
          onManual={() => setManual(true)}
        />
      </Menu>
      <Menu store={effortMenu} portal unmountOnHide gutter={8} aria-label="推理强度菜单" className={menuClass}>
        <EffortChoices disabled={disabled} agent={agent} selected={selected} effort={effort} />
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
    </>
  );
}
