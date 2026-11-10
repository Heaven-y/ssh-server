import { z } from 'zod';
import { formatSessionReference, parseSessionReference } from '@agentdeck/shared/conversation';
import type { SessionsService } from '../sessions/service';
import type { WorkspaceStore } from '../workspaces/store';
import { SessionReadError, safeSessionReadError } from './errors';
import { createSessionPagination, readableHistory } from './pagination';

export type { SessionReadPage } from './pagination';
export const SessionReadInput = z.strictObject({
  reference: z.string().min(1).max(1024),
  cursor: z.string().min(1).max(1024).optional(),
});

export function createSessionReader(deps: {
  sessions: Pick<SessionsService, 'read'>;
  store: Pick<WorkspaceStore, 'get'>;
}) {
  const pagination = createSessionPagination();
  return {
    async read(input: unknown, signal?: AbortSignal) {
      try {
        signal?.throwIfAborted();
        const parsed = SessionReadInput.safeParse(input);
        if (!parsed.success) {
          const cursorInvalid = parsed.error.issues.some((issue) => issue.path[0] === 'cursor');
          throw new SessionReadError(cursorInvalid ? 'invalid_cursor' : 'invalid_reference');
        }
        let location;
        try {
          location = parseSessionReference(parsed.data.reference);
        } catch {
          throw new SessionReadError('invalid_reference');
        }
        const reference = formatSessionReference(location);
        if (reference.length > 1024) throw new SessionReadError('invalid_reference');
        const workspace = await deps.store.get(location.workspaceId);
        if (!workspace) throw new SessionReadError('session_missing');
        const history = await deps.sessions.read(workspace, location.agent, location.sessionId, signal);
        signal?.throwIfAborted();
        return pagination.read({
          reference,
          workspaceDir: workspace.dir,
          history: readableHistory(history.events),
          cursor: parsed.data.cursor,
        });
      } catch (error) {
        throw safeSessionReadError(error, signal);
      }
    },
  };
}
export type SessionReader = ReturnType<typeof createSessionReader>;
