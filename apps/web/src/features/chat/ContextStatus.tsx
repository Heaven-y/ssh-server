import type { CompactionState, ContextUsage } from '@ssh-server/shared';
import { useChat } from './chat-store';

const numberFormat = new Intl.NumberFormat('zh-CN');
const tokens = (value?: number) => (value === undefined ? '不可用' : numberFormat.format(value));
const statusLabels: Record<CompactionState['status'], string> = {
  running: '正在压缩',
  completed: '压缩已完成',
  failed: '压缩失败',
  cancelled: '压缩已中断',
};
function compactionTitle(state: CompactionState, incomplete: boolean): string {
  const title = incomplete ? '压缩结果未确认' : statusLabels[state.status];
  if (!state.trigger) return title;
  return `${title} · ${state.trigger === 'manual' ? '手动' : '自动'}`;
}

export function CompactionStatus({ state, incomplete = false }: { state: CompactionState; incomplete?: boolean }) {
  const warning = incomplete || ['failed', 'cancelled'].includes(state.status);
  return (
    <div className={`space-y-1 text-xs leading-6 ${warning ? 'text-warning' : 'text-muted-foreground'}`}>
      <p>{compactionTitle(state, incomplete)}</p>
      {(state.beforeTokens !== undefined || state.afterTokens !== undefined) && (
        <p>
          压缩前 {tokens(state.beforeTokens)} tokens · 压缩后 {tokens(state.afterTokens)} tokens
        </p>
      )}
      {state.message && <p className="break-words">{state.message}</p>}
    </div>
  );
}

function usageSummary(usage?: ContextUsage | null): string {
  if (!usage) return '不可用';
  const source = usage.source === 'claude_estimate' ? 'Claude 原生估计' : 'Codex 原生统计/估算';
  return `${tokens(usage.usedTokens)} tokens · ${source}`;
}

function UsageDetails({ usage }: { usage?: ContextUsage | null }) {
  const percentage = usage?.source === 'claude_estimate' ? usage.percentage : undefined;
  return (
    <>
      <p>
        原生窗口：{tokens(usage?.windowTokens)} · 原生占用比例：{percentage === undefined ? '不可用' : `${percentage}%`}
      </p>
      <p className="break-all">模型：{usage?.model || '不可用'}</p>
    </>
  );
}

/** 原生缺失的数据保持不可用，不使用 token 数或配置窗口推算比例。 */
export function ContextStatus() {
  const usage = useChat((state) => state.contextUsage);
  const compaction = useChat((state) => state.compaction);
  const running = useChat((state) => state.running);
  const incomplete = compaction?.status === 'running' && !running;
  return (
    <details className="mx-auto w-full min-w-0 max-w-3xl rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer rounded leading-6">
        上下文：{usageSummary(usage)}
        {compaction && ` · ${compactionTitle(compaction, incomplete)}`}
      </summary>
      <div className="mt-2 space-y-2 border-t border-border pt-2 leading-6">
        <UsageDetails usage={usage} />
        {compaction && <CompactionStatus state={compaction} incomplete={incomplete} />}
      </div>
    </details>
  );
}
