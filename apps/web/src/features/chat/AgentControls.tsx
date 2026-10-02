import { useId } from 'react';
import type { AgentKind } from '@ssh-server/shared';
import { inputClass } from '../../ui/styles';
import { useChat } from './chat-store';

export const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' };

export function AgentControls() {
  const id = useId();
  const agent = useChat((state) => state.agent);
  const fixed = useChat((state) => !!state.sessionId || state.running || state.loadingHistory);
  const running = useChat((state) => state.running);
  const model = useChat((state) => state.modelOverrides[state.agent]);
  const actual = useChat((state) => state.actualModel);
  const effort = useChat((state) => state.reasoningEffort);
  const setAgent = useChat((state) => state.setAgent);
  const setModel = useChat((state) => state.setModel);
  const setEffort = useChat((state) => state.setReasoningEffort);
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
        <label htmlFor={`${id}-model`} className="flex flex-col gap-1">
          模型
          <input
            id={`${id}-model`}
            className={`${inputClass} w-40 py-1.5 font-mono text-xs`}
            value={model}
            disabled={running}
            onChange={(event) => setModel(event.target.value)}
            placeholder="跟随本地配置"
            spellCheck={false}
          />
        </label>
        {agent === 'codex' && (
          <label htmlFor={`${id}-effort`} className="flex flex-col gap-1">
            推理强度
            <input
              id={`${id}-effort`}
              className={`${inputClass} w-36 py-1.5 font-mono text-xs`}
              value={effort}
              disabled={running}
              onChange={(event) => setEffort(event.target.value)}
              placeholder="跟随本地配置"
              maxLength={40}
              spellCheck={false}
            />
          </label>
        )}
      </div>
      {actual && (
        <span className="max-w-full truncate" title={actual}>
          实际模型：{actual}
        </span>
      )}
    </div>
  );
}
