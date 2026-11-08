import { Layers } from 'lucide-react';
import { useChat } from './chat-store';
import { UsageDetails, usageSummary } from './ContextStatus';

/** 原生仅报告用量时展示用量，不将配置或 token 数伪装成完整提示词。 */
export function TrajectoryContext() {
  const usage = useChat((state) => state.contextUsage);
  if (!usage) return null;
  return (
    <details className="trajectory-context tool-card">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs">
        <Layers aria-hidden className="size-3.5 text-muted-foreground" />
        <span>上下文</span>
        <span className="min-w-0 truncate text-muted-foreground">{usageSummary(usage)}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">最近报告</span>
      </summary>
      <div className="space-y-1 border-t border-border px-3 py-3 text-xs leading-6 text-muted-foreground">
        <UsageDetails usage={usage} />
      </div>
    </details>
  );
}
