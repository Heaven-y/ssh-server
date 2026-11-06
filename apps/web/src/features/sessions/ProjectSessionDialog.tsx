import type { SessionSummary } from '@agentdeck/shared/conversation';

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
  const session =
    sessions.find(
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
