import type {
  AgentKind,
  SessionActionInput,
  SessionHistory,
  SessionRef,
  SessionSummary,
  Workspace,
} from '@ssh-server/shared';
import type { NativeSessionRead, NativeSessionSummary } from '../agents/types';
import { sameSessionDirectory } from '../agents/session-scope';

export type SessionProvider = {
  list(dir: string, signal?: AbortSignal, archived?: boolean): Promise<NativeSessionSummary[]>;
  read(id: string, dir: string, signal?: AbortSignal): Promise<NativeSessionRead>;
  assertBelongs(id: string, dir: string, signal?: AbortSignal): Promise<void>;
  mutate?(id: string, dir: string, input: SessionActionInput): Promise<void>;
};
type SessionOperations = {
  withIdleSession<T>(session: SessionRef, operation: () => Promise<T>): Promise<T>;
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

async function safeOperation<T>(agent: AgentKind, operation: () => Promise<T>, verb = '读取'): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError(
      503,
      'session_runtime_failed',
      `${agent === 'codex' ? 'Codex' : 'Claude Code'} 会话${verb}失败，请检查本机运行时与配置`,
    );
  }
}

export function createSessionsService(providers: Record<AgentKind, SessionProvider>, operations?: SessionOperations) {
  return {
    list(ws: Workspace, agent: AgentKind, signal?: AbortSignal, archived = false): Promise<SessionSummary[]> {
      return safeOperation(agent, async () => {
        if (archived && agent !== 'codex')
          throw new SessionError(400, 'unsupported_action', 'Claude Code 不支持归档会话');
        return (await providers[agent].list(ws.localDir, signal, archived)).map((session) => ({ ...session, agent }));
      });
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
    mutate(ws: Workspace, agent: AgentKind, id: string, input: SessionActionInput): Promise<void> {
      return safeOperation(
        agent,
        async () => {
          if (agent === 'claude' && (input.action === 'archive' || input.action === 'unarchive'))
            throw new SessionError(400, 'unsupported_action', 'Claude Code 不支持归档会话');
          const provider = providers[agent];
          if (!operations || !provider.mutate)
            throw new SessionError(503, 'session_management_unavailable', '当前原生会话管理不可用');
          await operations.withIdleSession({ agent, sessionId: id }, () => provider.mutate!(id, ws.localDir, input));
        },
        '操作',
      );
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
