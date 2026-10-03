import { LoaderCircle, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { AgentCapability } from '@ssh-server/shared';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass, inputClass } from '../../ui/styles';
import { useChat } from './chat-store';
import { capabilityRestriction } from './capability-selection';
import { useAgentCapabilities } from './use-agent-capabilities';

function CapabilityEntry({ entry, disabled, select }: { entry: AgentCapability; disabled: boolean; select(): void }) {
  const sessionId = useChat((state) => state.sessionId);
  const reason = capabilityRestriction(entry, sessionId);
  return (
    <li className="min-w-0 rounded-lg border border-border p-3">
      <button
        type="button"
        disabled={disabled || !!reason}
        onClick={select}
        className="w-full rounded text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="break-all text-sm font-medium">{entry.name}</span>
          <span className="text-xs text-muted-foreground">{entry.kind === 'skill' ? '技能' : '命令'}</span>
        </span>
        <span className="mt-1 block text-sm leading-6 break-words text-muted-foreground">{entry.description}</span>
        {entry.source && (
          <span className="mt-1 block break-all text-xs text-muted-foreground">来源：{entry.source}</span>
        )}
        {!!entry.aliases?.length && (
          <span className="mt-1 block break-all text-xs text-muted-foreground">别名：{entry.aliases.join('、')}</span>
        )}
      </button>
      {reason && <p className="mt-2 text-xs leading-5 text-warning">{reason}</p>}
    </li>
  );
}

function CapabilityDialog({ disabled, onClose }: { disabled: boolean; onClose(): void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const query = useAgentCapabilities(true);
  const select = useChat((state) => state.selectCapability);
  const phrase = search.trim().toLocaleLowerCase();
  const entries = (query.data?.entries ?? []).filter((entry) =>
    [entry.name, entry.description, entry.source, ...(entry.aliases ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(phrase),
  );
  return (
    <DetailDialog title="技能与命令" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <label htmlFor={id} className="min-w-0 flex-1 text-sm">
            搜索原生能力
            <input
              id={id}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
              className={`${inputClass} mt-2`}
              placeholder="名称、说明或别名"
            />
          </label>
          <button
            type="button"
            className={buttonClass('outline')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            aria-label="刷新技能与命令"
          >
            <RefreshCw aria-hidden className="size-4" />
          </button>
        </div>
        {query.isFetching && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
            正在读取原生能力…
          </p>
        )}
        {query.isError && (
          <p role="alert" className="text-sm text-destructive-foreground">
            能力目录读取失败，请刷新重试；仍可关闭后发送普通消息。
          </p>
        )}
        {query.data?.warnings.map((warning, index) => (
          <p key={index} className="text-xs leading-6 text-warning">
            {warning}
          </p>
        ))}
        <ul aria-label="原生技能与命令" className="space-y-2">
          {entries.map((entry) => (
            <CapabilityEntry
              key={entry.id}
              entry={entry}
              disabled={disabled}
              select={() => {
                select(entry);
                onClose();
              }}
            />
          ))}
        </ul>
        {query.data && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {phrase ? '没有匹配的技能或命令。' : '当前运行时未提供技能或命令。'}
          </p>
        )}
      </div>
    </DetailDialog>
  );
}

function ScopedPicker({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const selection = useChat((state) => state.selectedCapability);
  const select = useChat((state) => state.selectCapability);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${buttonClass('ghost')} px-2 text-xs`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden className="size-4" />
        技能与命令
      </button>
      {selection && (
        <span className="flex min-w-0 max-w-full items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
          <Sparkles aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 break-all">{selection.name}</span>
          <button
            type="button"
            aria-label="移除所选能力"
            disabled={disabled}
            className="rounded p-1 hover:bg-card"
            onClick={() => select()}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      )}
      {open && <CapabilityDialog disabled={disabled} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function CapabilityPicker({ disabled }: { disabled: boolean }) {
  const scope = useChat((state) => JSON.stringify([state.workspaceId, state.agent, state.sessionId]));
  return <ScopedPicker key={scope} disabled={disabled} />;
}
