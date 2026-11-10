import { GripVertical, LoaderCircle } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import type { SessionSummary } from '@agentdeck/shared/conversation';
import { AGENT_LABELS } from '../../cli/shared/labels';
import { relativeTime } from '../../ui/relative-time';
import { SessionMenu, type SessionDialogAction, type SessionMenuAction } from './SessionMenu';
import { SessionLinkNotice, useSessionLinkCopy } from './use-session-link-copy';
import { useSessionBusy } from './use-session-busy';
import { AgentIcon } from '../../ui/BrandIcons';

const fullTime = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function rowDetails(session: SessionSummary, running: boolean) {
  const updated = new Date(session.updatedAt);
  const time = Number.isNaN(updated.getTime()) ? '' : relativeTime(updated.getTime());
  const title = session.title || '未命名会话';
  return {
    updated,
    time,
    title,
    label: `${title} · ${AGENT_LABELS[session.agent]}${time ? ` · ${time}` : ''}${running ? ' · 运行中' : ''}`,
  };
}

function Management({
  session,
  archived,
  disabled,
  choose,
}: {
  session: SessionSummary;
  archived: boolean;
  disabled: boolean;
  choose(action: SessionMenuAction): void;
}) {
  return (
    <SessionMenu
      session={session}
      archived={archived}
      pinned={false}
      localActions={false}
      disabled={disabled}
      choose={choose}
    />
  );
}

function RowContent({ session, running }: { session: SessionSummary; running: boolean }) {
  const { updated, time, title } = rowDetails(session, running);
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center" title={AGENT_LABELS[session.agent]}>
        <AgentIcon agent={session.agent} className="size-3.5" />
      </span>
      {running && <LoaderCircle aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin text-accent" />}
      <span className="min-w-0 flex-1 truncate leading-5">{title}</span>
      {time && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={fullTime.format(updated)}>
          {time}
        </span>
      )}
    </>
  );
}

type RowProps = {
  session: SessionSummary;
  workspaceId?: string;
  active: boolean;
  archived?: boolean;
  select?: () => void;
  manage?(action: SessionDialogAction): void;
  rowProps?: HTMLAttributes<HTMLLIElement>;
};

function RowFrame({ active, rowProps, children }: Pick<RowProps, 'active' | 'rowProps'> & { children: ReactNode }) {
  return (
    <li
      {...rowProps}
      data-active={active || undefined}
      className="project-session-row flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg"
    >
      {rowProps?.draggable && (
        <GripVertical aria-hidden className="ml-1 size-3 shrink-0 cursor-grab text-muted-foreground" />
      )}
      {children}
    </li>
  );
}

function RowEntry({
  session,
  active,
  archived,
  select,
  rowProps,
  running,
  pending,
}: RowProps & { running: boolean; pending: boolean }) {
  const { label } = rowDetails(session, running);
  const content = <RowContent session={session} running={running} />;
  const className =
    'flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-interactive';
  if (!select || archived)
    return (
      <div className={className} title={archived ? `${label} · 已归档，恢复后继续` : label}>
        {content}
      </div>
    );
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      aria-label={label}
      title={rowProps?.draggable ? `${label} · 拖动或 Alt+↑/↓ 调整顺序` : label}
      className={`${className} ${active ? 'font-medium' : 'hover:bg-muted/60 hover:text-foreground'}`}
      disabled={pending}
      onClick={select}
    >
      {content}
    </button>
  );
}

/** 普通和归档行复用原生身份；未归属会话只展示摘要，没有写入口。 */
export function ProjectSessionRow({
  session,
  workspaceId,
  active,
  archived = false,
  select,
  manage,
  rowProps,
}: RowProps) {
  const { pending, running } = useSessionBusy(workspaceId ?? '', session);
  const copy = useSessionLinkCopy(workspaceId ?? '');
  const choose = (action: SessionMenuAction) => {
    copy.clear();
    if (action === 'copy' || action === 'copy-id') void copy.copy(session, action === 'copy-id' ? 'id' : 'link');
    else if (action !== 'pin') manage?.(action);
  };
  return (
    <RowFrame active={active} rowProps={rowProps}>
      <RowEntry
        session={session}
        active={active}
        archived={archived}
        select={select}
        rowProps={rowProps}
        running={running}
        pending={pending}
      />
      {workspaceId && manage && (
        <Management session={session} archived={archived} disabled={pending || running} choose={choose} />
      )}
      {copy.notice && <SessionLinkNotice notice={copy.notice} link={copy.link} />}
    </RowFrame>
  );
}
