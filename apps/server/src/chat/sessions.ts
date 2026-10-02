import type { AgentKind, SessionHistory, SessionSummary, Workspace } from '@ssh-server/shared';
import type { NativeSessionRead, NativeSessionSummary } from '../agents/types';
import { sameSessionDirectory } from '../agents/session-scope';

export type SessionProvider = {
  list(dir: string, signal?: AbortSignal): Promise<NativeSessionSummary[]>;
  read(id: string, dir: string, signal?: AbortSignal): Promise<NativeSessionRead>;
  assertBelongs(id: string, dir: string, signal?: AbortSignal): Promise<void>;
};

export class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function safeOperation<T>(agent: AgentKind, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError(
      503,
      'session_runtime_failed',
      `${agent === 'codex' ? 'Codex' : 'Claude Code'} 会话读取失败，请检查本机运行时与配置`,
    );
  }
}

export function createSessionsService(providers: Record<AgentKind, SessionProvider>) {
  return {
    list(ws: Workspace, agent: AgentKind, signal?: AbortSignal): Promise<SessionSummary[]> {
      return safeOperation(agent, async () =>
        (await providers[agent].list(ws.localDir, signal)).map((session) => ({ ...session, agent })),
      );
    },
    read(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<SessionHistory> {
      return safeOperation(agent, async () => {
        const record = await providers[agent].read(id, ws.localDir, signal);
        if (record.session.sessionId !== id || !(await sameSessionDirectory(record.cwd, ws.localDir)))
          throw new SessionError(404, 'session_missing', '该 Agent 在当前工作区中没有此会话');
        return { session: { ...record.session, agent }, events: record.events, actualModel: record.actualModel };
      });
    },
    assertBelongs(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<void> {
      return safeOperation(agent, () => providers[agent].assertBelongs(id, ws.localDir, signal));
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
