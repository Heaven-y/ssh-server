import { RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import type { AgentKind } from '@ssh-server/shared';
import { buttonClass, inputClass } from '../../ui/styles';
import { useChat } from './chat-store';
import { useAgentCapabilities } from './use-agent-capabilities';

export const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };

function ModelControls() {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const agent = useChat((state) => state.agent);
  const running = useChat((state) => state.running);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  const effort = useChat((state) => state.reasoningEffort);
  const setModel = useChat((state) => state.setModel);
  const setEffort = useChat((state) => state.setReasoningEffort);
  const catalog = useAgentCapabilities(focused);
  const models = catalog.data?.models ?? [];
  const efforts = models.find((candidate) => candidate.id === model)?.reasoningEfforts ?? [];
  return (
    <div className="flex min-w-0 max-w-full flex-col items-end gap-1.5">
      <div className="flex max-w-full flex-wrap items-start justify-end gap-2">
        <label htmlFor={`${id}-model`} className="flex flex-col gap-1">
          模型
          <input
            id={`${id}-model`}
            list={`${id}-models`}
            className={`${inputClass} w-40 py-1.5 font-mono text-xs`}
            value={model}
            disabled={running}
            onChange={(event) => setModel(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="跟随本地配置"
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
          <label htmlFor={`${id}-effort`} className="flex flex-col gap-1">
            推理强度
            <input
              id={`${id}-effort`}
              list={`${id}-efforts`}
              className={`${inputClass} w-36 py-1.5 font-mono text-xs`}
              value={effort}
              disabled={running}
              onChange={(event) => setEffort(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="跟随本地配置"
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
          className={`${buttonClass('ghost')} mt-4 px-2`}
          disabled={catalog.isFetching}
          onClick={() => void catalog.refetch()}
        >
          <RefreshCw aria-hidden className="size-4" />
        </button>
      </div>
      {catalog.isFetching && <span role="status">正在读取模型候选…</span>}
      {catalog.isError && <span role="status">候选暂不可用，仍可手动输入或跟随配置。</span>}
      {!!catalog.data?.warnings.length && (
        <span title={catalog.data.warnings.join('\n')}>部分原生能力不可用，详情见技能与命令。</span>
      )}
    </div>
  );
}

export function AgentControls() {
  const id = useId();
  const agent = useChat((state) => state.agent);
  const fixed = useChat((state) => !!state.sessionId || state.running || state.loadingHistory);
  const actual = useChat((state) => state.actualModel);
  const setAgent = useChat((state) => state.setAgent);
  return (
    <div className="flex min-w-0 max-w-full flex-col items-end gap-1.5 text-xs text-muted-foreground">
      <div className="flex max-w-full flex-wrap items-start justify-end gap-2">
        <label htmlFor={`${id}-agent`} className="flex flex-col gap-1">
          Agent
          <select
            id={`${id}-agent`}
            className={`${inputClass} w-28 py-1.5 text-xs`}
            value={agent}
            disabled={fixed}
            title={fixed ? '会话固定使用原 Agent；使用另一 Agent 请新建会话' : undefined}
            onChange={(event) => setAgent(event.target.value as AgentKind)}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <ModelControls />
      </div>
      {actual && (
        <span className="max-w-full truncate" title={actual}>
          实际模型：{actual}
        </span>
      )}
    </div>
  );
}
