import type { AgentKind } from '@agentdeck/shared/conversation';
import { buttonClass } from '../../ui/styles';
import { nativeAgentNames, nativeSettingsError } from './native-resource-labels';
import { useSessionTools } from './use-session-tools';

type State = ReturnType<typeof useSessionTools>;

function AccessActions({ state }: { state: State }) {
  const { status, mutation } = state;
  const pending = mutation.isPending || status.isFetching;
  const enabled = status.data?.enabled === true;
  const available = status.data?.available === true;
  const label = enabled ? '停用会话读取' : '启用会话读取';
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        className={buttonClass('ghost')}
        disabled={pending}
        onClick={() => {
          mutation.reset();
          void status.refetch();
        }}
      >
        重新读取
      </button>
      <button
        type="button"
        className={buttonClass('outline')}
        disabled={pending || !available}
        onClick={() => mutation.mutate(!enabled)}
      >
        {mutation.isPending ? '正在应用…' : label}
      </button>
    </div>
  );
}

function AccessFeedback({ state }: { state: State }) {
  const { status, mutation } = state;
  const error = mutation.error ?? status.error;
  return (
    <>
      {status.isPending && (
        <p role="status" className="text-muted-foreground">
          正在读取状态…
        </p>
      )}
      {status.data?.message && <p className="text-muted-foreground">{status.data.message}</p>}
      {error && (
        <p role="alert" className="text-destructive-foreground">
          {nativeSettingsError(error)}
        </p>
      )}
    </>
  );
}

export function SessionToolsPanel({ agent, compact = false }: { agent: AgentKind; compact?: boolean }) {
  const state = useSessionTools(agent);
  return (
    <section
      aria-label={`${nativeAgentNames[agent]} 会话读取`}
      className={compact ? 'space-y-2 text-xs' : 'space-y-3 border-t border-border pt-4 text-[13px]'}
    >
      {!compact && <h4 className="font-medium">会话读取</h4>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground">
          {state.status.data?.enabled
            ? '已启用，可按链接读取三个 CLI 的会话历史。'
            : `启用后，${nativeAgentNames[agent]} 可按会话链接读取历史。`}
        </p>
        <AccessActions state={state} />
      </div>
      <AccessFeedback state={state} />
      {!compact && (
        <p className="text-xs leading-5 text-muted-foreground">
          会在此 CLI 的用户配置中添加只读工具；只读取本机已添加工作区的会话，权限仍由 CLI 确认。
        </p>
      )}
    </section>
  );
}
