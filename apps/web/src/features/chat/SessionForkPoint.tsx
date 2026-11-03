import { GitFork } from 'lucide-react';
import { useState } from 'react';
import type { SessionRef } from '@agentdeck/shared';
import { buttonClass } from '../../ui/styles';
import { managementPending, useChat } from './chat-store';
import { SessionForkDialog } from '../workspaces/SessionForkDialog';

export function SessionForkPoint({ pointId }: { pointId: string }) {
  const [selected, setSelected] = useState<{ workspaceId: string; session: SessionRef & { title: string } }>();
  const available = useChat(
    (state) =>
      !!state.workspaceId && !!state.sessionId && !state.running && !state.loadingHistory && !managementPending(state),
  );
  const open = () => {
    const current = useChat.getState();
    if (!available || !current.workspaceId || !current.sessionId) return;
    setSelected({
      workspaceId: current.workspaceId,
      session: { agent: current.agent, sessionId: current.sessionId, title: '当前会话' },
    });
  };
  return (
    <div data-fork-point={pointId} className="flex justify-end border-t border-border/50 pt-1">
      <button
        type="button"
        className={`${buttonClass('ghost')} text-xs`}
        disabled={!available}
        onClick={open}
        title="从此位置创建独立会话"
      >
        <GitFork aria-hidden className="size-3.5" />
        从此处分叉
      </button>
      {selected && <SessionForkDialog {...selected} pointId={pointId} onClose={() => setSelected(undefined)} />}
    </div>
  );
}
