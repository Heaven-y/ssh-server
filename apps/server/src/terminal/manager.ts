import type WebSocket from 'ws';
import { TERMINAL_LIMITS } from '@ssh-server/shared';
import type { WorkspaceStore } from '../workspaces/store';
import type { SshPool } from '../ssh/pool';
import type { TerminalBindings } from './binding';
import { TerminalError } from './errors';
import { createTerminalSession, type TerminalSession } from './session';

export function createTerminalManager(deps: {
  store: Pick<WorkspaceStore, 'get'>;
  pool: SshPool;
  bindings: TerminalBindings;
}) {
  const sessions = new Set<TerminalSession>();
  const counts = new Map<string, number>();
  let disposed = false;
  return {
    attach(workspaceId: string, socket: WebSocket) {
      const count = counts.get(workspaceId) ?? 0;
      if (disposed || count >= TERMINAL_LIMITS.workspaceSessions || sessions.size >= TERMINAL_LIMITS.totalSessions) {
        const error = new TerminalError('limit_reached');
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
      sessions.add(session);
    },
    dispose() {
      disposed = true;
      for (const session of [...sessions]) session.close();
    },
  };
}
export type TerminalManager = ReturnType<typeof createTerminalManager>;
