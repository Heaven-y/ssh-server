import { RefreshCw } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import type { AgentKind } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { useChat } from './chat-store';
import { useAgentCapabilities } from './use-agent-capabilities';
import { agentUnavailable, useEnvironment } from '../settings/use-environment';

export const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };

function CatalogStatus({ catalog }: { catalog: ReturnType<typeof useAgentCapabilities> }) {
  return (
    <>
      {catalog.isFetching && (
        <span role="status" className="text-xs text-muted-foreground">
          正在读取模型候选…
        </span>
      )}
      {catalog.isError && (
        <span role="status" className="text-xs text-muted-foreground">
          候选暂不可用，仍可手动输入或跟随配置。
        </span>
      )}
      {!!catalog.data?.warnings.length && (
        <span className="text-xs text-warning" title={catalog.data.warnings.join('\n')}>
          部分原生能力不可用，详情见技能与命令。
        </span>
      )}
    </>
  );
}

/** 底栏选项不是消息输入，Enter 不应触发表单隐式发送。 */
function preventImplicitSubmit(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

function ModelControls({ disabled }: { disabled: boolean }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const agent = useChat((state) => state.agent);
  const historical = useChat((state) => !!state.sessionId);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  const effort = useChat((state) => state.reasoningEffort);
  const setModel = useChat((state) => state.setModel);
  const setEffort = useChat((state) => state.setReasoningEffort);
  const catalog = useAgentCapabilities(focused);
  const models = catalog.data?.models ?? [];
  const efforts = models.find((candidate) => candidate.id === model)?.reasoningEfforts ?? [];
  return (
    <>
      <label htmlFor={`${id}-model`} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        模型
        <input
          id={`${id}-model`}
          list={`${id}-models`}
          className={`${inputClass} min-h-9 w-36 px-2 py-1.5 font-mono text-xs`}
          value={model}
          disabled={disabled}
          onChange={(event) => setModel(event.target.value)}
          onKeyDown={preventImplicitSubmit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={historical ? '沿用会话模型' : '跟随本地配置'}
          title="下轮模型覆盖；不代表已运行的实际模型"
          spellCheck={false}
        />
        <datalist id={`${id}-models`}>
          {models.map((candidate) => (
            <option
              key={candidate.id}
              value={candidate.id}
              label={candidate.description ? `${candidate.label} · ${candidate.description}` : candidate.label}
            />
          ))}
        </datalist>
      </label>
      {agent === 'codex' && (
        <label htmlFor={`${id}-effort`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="sr-only">推理强度</span>
          <input
            id={`${id}-effort`}
            list={`${id}-efforts`}
            className={`${inputClass} min-h-9 w-28 px-2 py-1.5 font-mono text-xs`}
            value={effort}
            disabled={disabled}
            onChange={(event) => setEffort(event.target.value)}
            onKeyDown={preventImplicitSubmit}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="默认推理强度"
            title="下轮推理强度；留空沿用原生设置"
            maxLength={40}
            spellCheck={false}
          />
          <datalist id={`${id}-efforts`}>
            {efforts.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
      )}
      <button
        type="button"
        aria-label="刷新原生模型候选"
        title="候选仅作建议，也可手动输入模型与推理强度"
        className={`${buttonClass('ghost')} px-2`}
        disabled={disabled || catalog.isFetching}
        onClick={() => void catalog.refetch()}
      >
        <RefreshCw aria-hidden className="size-4" />
      </button>
      <CatalogStatus catalog={catalog} />
    </>
  );
}

export function AgentControls({ disabled = false }: { disabled?: boolean }) {
  const id = useId();
  const agent = useChat((state) => state.agent);
  const fixed = useChat((state) => !!state.sessionId || state.running || state.loadingHistory);
  const setAgent = useChat((state) => state.setAgent);
  const environment = useEnvironment();
  return (
    <>
      <label htmlFor={`${id}-agent`}>
        <span className="sr-only">Agent</span>
        <select
          id={`${id}-agent`}
          className={`${inputClass} min-h-9 w-24 px-2 py-1.5 text-xs`}
          value={agent}
          disabled={fixed || disabled}
          title={fixed ? '会话固定使用原 Agent；使用另一 Agent 请新建会话' : '运行来源'}
          onChange={(event) => setAgent(event.target.value as AgentKind)}
        >
          {(['claude', 'codex'] as const).map((kind) => (
            <option key={kind} value={kind} disabled={agentUnavailable(environment.data, kind)}>
              {AGENT_LABELS[kind]}
              {agentUnavailable(environment.data, kind) ? ' · 不可用' : ''}
            </option>
          ))}
        </select>
      </label>
      <ModelControls disabled={disabled} />
      {agentUnavailable(environment.data, agent) && (
        <p role="status" className="text-xs text-muted-foreground">
          {AGENT_LABELS[agent]} 当前不可用，请到设置查看安装与配置指引；已有会话仍可查看和管理。
        </p>
      )}
    </>
  );
}
