import { LoaderCircle } from 'lucide-react';
import type { AgentKind } from '@agentdeck/shared/conversation';
import { AGENT_LABELS } from '../../cli/shared/labels';
import { AgentBadge } from './AgentBadge';

/** 会话头：CLI、实际驱动版本、项目路径与运行状态；只陈述已知事实，缺哪项就不画哪项。 */
export function SessionHeader({
  agent,
  title,
  version,
  projectDir,
  running = false,
}: {
  agent: AgentKind;
  title: string;
  version?: string;
  projectDir?: string;
  running?: boolean;
}) {
  const name = title.trim() || '未命名会话';
  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/70 px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium" title={name}>
          {name}
        </h1>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <AgentBadge agent={agent} className="size-4 text-[9px]" />
          <span>{AGENT_LABELS[agent]}</span>
          {version && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums" title="实际驱动的 CLI 版本">
                {version}
              </span>
            </>
          )}
          {projectDir && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate font-mono" title={projectDir}>
                {projectDir}
              </span>
            </>
          )}
        </p>
      </div>
      {running && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-accent">
          <LoaderCircle aria-hidden className="size-3.5 motion-safe:animate-spin" />
          运行中
        </span>
      )}
    </header>
  );
}
