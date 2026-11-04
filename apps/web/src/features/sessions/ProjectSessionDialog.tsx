import type { SessionSummary } from '@agentdeck/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';
import { SessionActionsDialog } from './SessionActionsDialog';
import { SessionForkDialog } from './SessionForkDialog';
import type { SessionDialogAction } from './SessionMenu';

export type ProjectSessionSelection = {
  workspaceId: string;
  session: SessionSummary;
  archived: boolean;
  action: SessionDialogAction;
};

/** 操作目标来自被点击的行，不读取当前选中的项目来猜测。 */
export function ProjectSessionDialog({
  selected,
  sessions,
  close,
}: {
  selected: ProjectSessionSelection;
  sessions: SessionSummary[];
  close(): void;
}) {
  // 只订阅现有列表缓存；归档页刷新摘要后，已打开的确认框也要立即遵守最新运行态。
  const cached = useQuery({
    queryKey: queryKeys.sessions(selected.workspaceId, selected.session.agent, selected.archived),
    queryFn: ({ signal }) => api.listSessions(selected.workspaceId, selected.session.agent, selected.archived, signal),
    enabled: false,
  });
  const session =
    (cached.data ?? sessions).find(
      (entry) => entry.agent === selected.session.agent && entry.sessionId === selected.session.sessionId,
    ) ?? selected.session;
  if (selected.action === 'fork')
    return <SessionForkDialog workspaceId={selected.workspaceId} session={session} onClose={close} />;
  return (
    <SessionActionsDialog
      workspaceId={selected.workspaceId}
      session={session}
      archived={selected.archived}
      action={selected.action}
      onClose={close}
      onCompleted={close}
    />
  );
}
