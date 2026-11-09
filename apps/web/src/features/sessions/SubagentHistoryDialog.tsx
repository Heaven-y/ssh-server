import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { GitFork } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DetailDialog } from '../../ui/DetailDialog';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { buttonClass, inputClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { historyItems, type ChatItem } from '../chat/chat-reducer';
import { ChatTimeline } from '../chat/ChatTimeline';
import { TrajectoryContent } from '../chat/TrajectoryView';
import { TrajectoryDetails } from '../chat/TrajectoryDetails';
import { sessionsApi } from './api';

type Identity = { workspaceId: string; sessionId: string };

function SubagentTrajectory({ items }: { items: ChatItem[] }) {
  const [selected, setSelected] = useState<string>();
  const item = items.find((entry) => entry.id === selected);
  return (
    <>
      <TrajectoryContent items={items} running={false} selectedItemId={selected} inspect={setSelected} />
      {item && (
        <DetailDialog title="子代理步骤" onClose={() => setSelected(undefined)}>
          <TrajectoryDetails item={item} />
        </DetailDialog>
      )}
    </>
  );
}

function HistoryStatus({
  pending,
  failed,
  empty,
  retry,
}: {
  pending: boolean;
  failed: boolean;
  empty: boolean;
  retry(): void;
}) {
  if (pending)
    return (
      <p role="status" className="m-auto text-sm text-muted-foreground">
        正在读取…
      </p>
    );
  if (failed)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        子代理历史读取失败。
        <button type="button" className={buttonClass('ghost')} onClick={retry}>
          重试
        </button>
      </p>
    );
  return empty ? <p className="m-auto text-sm text-muted-foreground">没有可显示的记录</p> : null;
}

function ChildHistory({ workspaceId, sessionId, agentId }: Identity & { agentId: string }) {
  const [view, setView] = useState<'chat' | 'trajectory'>('chat');
  const history = useInfiniteQuery({
    queryKey: ['subagent-history', workspaceId, sessionId, agentId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await sessionsApi.subagents(workspaceId, sessionId, { agentId, cursor: pageParam }, signal);
      if (!('agentId' in result) || result.agentId !== agentId) throw new Error('子代理记录不匹配');
      return result;
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const items = useMemo(() => historyItems(history.data?.pages.flatMap((page) => page.events) ?? []), [history.data]);
  const parent = history.data?.pages.find((page) => page.parentAgentId)?.parentAgentId;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SegmentedControl<'chat' | 'trajectory'>
          label="子代理视图"
          value={view}
          onChange={setView}
          options={[
            { value: 'chat', label: '对话' },
            { value: 'trajectory', label: '轨迹' },
          ]}
        />
        {parent && <span className="text-xs text-muted-foreground">来自子代理 {parent}</span>}
      </div>
      <HistoryStatus
        pending={history.isPending}
        failed={history.isError}
        empty={items.length === 0}
        retry={() => void history.refetch()}
      />
      {items.length > 0 &&
        (view === 'chat' ? <ChatTimeline items={items} running={false} /> : <SubagentTrajectory items={items} />)}
      {history.hasNextPage && (
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? '正在读取…' : '继续加载'}
        </button>
      )}
    </div>
  );
}

function SubagentHistoryDialog({ workspaceId, sessionId, onClose }: Identity & { onClose(): void }) {
  const [selected, setSelected] = useState('');
  const agents = useQuery({
    queryKey: ['subagents', workspaceId, sessionId],
    queryFn: async ({ signal }) => {
      const result = await sessionsApi.subagents(workspaceId, sessionId, {}, signal);
      if (!('agentIds' in result)) throw new Error('子代理目录格式不正确');
      return result.agentIds;
    },
    gcTime: 0,
    retry: false,
  });
  const agentId = agents.data?.includes(selected) ? selected : agents.data?.[0];
  return (
    <DetailDialog title="子代理历史" onClose={onClose}>
      <div className="flex h-[min(60dvh,640px)] min-h-0 flex-col gap-3">
        {agents.isPending && (
          <p role="status" className="m-auto text-sm text-muted-foreground">
            正在读取…
          </p>
        )}
        {agents.isError && (
          <p role="alert" className="text-sm text-destructive-foreground">
            子代理目录读取失败。
            <button className={buttonClass('ghost')} onClick={() => void agents.refetch()}>
              重试
            </button>
          </p>
        )}
        {agents.data?.length === 0 && <p className="m-auto text-sm text-muted-foreground">这条会话没有子代理记录</p>}
        {agentId && (
          <>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              子代理
              <select
                aria-label="选择子代理"
                className={`${inputClass} min-w-0 flex-1`}
                value={agentId}
                onChange={(event) => setSelected(event.target.value)}
              >
                {agents.data?.map((id, index) => (
                  <option key={id} value={id}>
                    子代理 {index + 1} · {id}
                  </option>
                ))}
              </select>
            </label>
            <ChildHistory key={agentId} workspaceId={workspaceId} sessionId={sessionId} agentId={agentId} />
          </>
        )}
      </div>
    </DetailDialog>
  );
}

function HistoryButton(props: Identity) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${buttonClass('ghost')} text-xs`} onClick={() => setOpen(true)}>
        <GitFork aria-hidden className="size-3.5" />
        子代理
      </button>
      {open && <SubagentHistoryDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SubagentHistoryButton() {
  const agent = useChat((state) => state.agent);
  const workspaceId = useChat((state) => state.workspaceId);
  const sessionId = useChat((state) => state.sessionId);
  if (agent !== 'claude' || !workspaceId || !sessionId) return null;
  return <HistoryButton key={`${workspaceId}:${sessionId}`} workspaceId={workspaceId} sessionId={sessionId} />;
}
