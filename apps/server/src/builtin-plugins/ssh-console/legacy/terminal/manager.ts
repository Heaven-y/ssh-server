import type WebSocket from 'ws';
import { TERMINAL_LIMITS } from '@agentdeck/shared/ssh';
import type { WorkspaceStore } from '../../../../workspaces/store';
import type { SshPool } from '../../ssh/pool';
import type { TerminalBindings } from './binding';
import { TerminalError } from './errors';
import { createTerminalSession, type TerminalSession } from './session';

export function createTerminalManager(deps: {
  store: Pick<WorkspaceStore, 'get'>;
  pool: SshPool;
  bindings: TerminalBindings;
  isEnabled?: () => boolean;
}) {
  const sessions = new Map<TerminalSession, string>();
  const counts = new Map<string, number>();
  let disposed = false;
  const closeAll = () => {
    for (const session of [...sessions.keys()]) session.close();
  };
  return {
    attach(workspaceId: string, socket: WebSocket) {
      const count = counts.get(workspaceId) ?? 0;
      const disabled = deps.isEnabled?.() === false;
      if (
        disabled ||
        disposed ||
        count >= TERMINAL_LIMITS.workspaceSessions ||
        sessions.size >= TERMINAL_LIMITS.totalSessions
      ) {
        const error = new TerminalError(disabled ? 'plugin_disabled' : 'limit_reached');
        socket.send(JSON.stringify({ type: 'error', code: error.code, message: error.message }));
        socket.close(1008);
        return;
      }
      counts.set(workspaceId, count + 1);
      const session = createTerminalSession({
        workspaceId,
        socket,
        pool: deps.pool,
        bindings: deps.bindings,
        onClosed: () => {
          sessions.delete(session);
          const remaining = (counts.get(workspaceId) ?? 1) - 1;
          if (remaining) counts.set(workspaceId, remaining);
          else counts.delete(workspaceId);
        },
      });
      sessions.set(session, workspaceId);
    },
    closeWorkspace(workspaceId: string) {
      for (const [session, id] of sessions) if (id === workspaceId) session.close();
    },
    closeAll,
    dispose() {
      disposed = true;
      closeAll();
    },
  };
}
export type TerminalManager = ReturnType<typeof createTerminalManager>;
