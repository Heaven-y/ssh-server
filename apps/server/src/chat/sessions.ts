import {
  NativeSessionIdSchema,
  type SessionForkInput,
  type AgentKind,
  type SessionActionInput,
  type SessionHistory,
  type SessionRef,
  type SessionSummary,
  type Workspace,
} from '@agentdeck/shared';
import type { NativeSessionFork, NativeSessionRead, NativeSessionSummary } from '../agents/types';
import { sameSessionDirectory } from '../agents/session-scope';

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

export type SessionProvider = {
  list(dir: string, signal?: AbortSignal, archived?: boolean): Promise<NativeSessionSummary[]>;
  read(id: string, dir: string, signal?: AbortSignal): Promise<NativeSessionRead>;
  assertBelongs(id: string, dir: string, signal?: AbortSignal): Promise<void>;
  mutate(id: string, dir: string, input: SessionActionInput): Promise<void>;
  fork(id: string, dir: string, input: SessionForkInput): Promise<NativeSessionFork>;
};
type SessionOperations = {
  withIdleSession<T>(session: SessionRef, operation: () => Promise<T>): Promise<T>;
  /** 该原生会话是否正被本网页驱动；未接入时按未运行上报。 */
  isRunning?(session: SessionRef): boolean;
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
      `${AGENT_LABELS[agent]} 会话${verb}失败，请检查本机运行时与配置`,
    );
  }
}

/** 适配器缺失时按「本轮不支持该 CLI」拒绝，与 TurnManager 的 agent_unavailable 保持一致。 */
function providerOf<T>(providers: Partial<Record<AgentKind, T>>, agent: AgentKind): T {
  const provider = providers[agent];
  if (!provider) throw new SessionError(503, 'agent_unavailable', `${AGENT_LABELS[agent]} 适配器尚未接入`);
  return provider;
}

export function createSessionsService(
  providers: Partial<Record<AgentKind, SessionProvider>>,
  operations: SessionOperations,
) {
  return {
    list(ws: Workspace, agent: AgentKind, signal?: AbortSignal, archived = false): Promise<SessionSummary[]> {
      return safeOperation(agent, async () => {
        const provider = providerOf(providers, agent);
        if (archived && agent !== 'codex')
          throw new SessionError(400, 'unsupported_action', `${AGENT_LABELS[agent]} 不支持归档会话`);
        return (await provider.list(ws.dir, signal, archived)).map((session) => ({
          agent,
          sessionId: session.sessionId,
          // 项目归属裁决在后续任务接入；此前一律按「未归属」上报，不猜测。
          projectId: null,
          title: session.summary,
          updatedAt: new Date(session.lastModified).toISOString(),
          running: operations.isRunning?.({ agent, sessionId: session.sessionId }) ?? false,
        }));
      });
    },
    read(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<SessionHistory> {
      return safeOperation(agent, async () => {
        const record = await providerOf(providers, agent).read(id, ws.dir, signal);
        if (record.session.sessionId !== id || !(await sameSessionDirectory(record.cwd, ws.dir)))
          throw new SessionError(404, 'session_missing', '该 Agent 在当前项目目录中没有此会话');
        return { session: { ...record.session, agent }, events: record.events, actualModel: record.actualModel };
      });
    },
    assertBelongs(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<void> {
      return safeOperation(agent, () => providerOf(providers, agent).assertBelongs(id, ws.dir, signal));
    },
    fork(ws: Workspace, agent: AgentKind, id: string, input: SessionForkInput): Promise<SessionHistory['session']> {
      return safeOperation(
        agent,
        () =>
          operations.withIdleSession({ agent, sessionId: id }, async () => {
            // 提供方在锁内核验源与分叉点；原生返回后仍在锁内复核新身份。
            const result = await providerOf(providers, agent).fork(id, ws.dir, input);
            const newId = NativeSessionIdSchema.safeParse(result.session.sessionId);
            if (!newId.success || newId.data === id || !(await sameSessionDirectory(result.cwd, ws.dir)))
              throw new SessionError(503, 'session_runtime_failed', '原生分叉返回了无效的新会话');
            return { ...result.session, agent };
          }),
        '分叉',
      );
    },
    mutate(ws: Workspace, agent: AgentKind, id: string, input: SessionActionInput): Promise<void> {
      return safeOperation(
        agent,
        async () => {
          const provider = providerOf(providers, agent);
          if (agent !== 'codex' && (input.action === 'archive' || input.action === 'unarchive'))
            throw new SessionError(400, 'unsupported_action', `${AGENT_LABELS[agent]} 不支持归档会话`);
          await operations.withIdleSession({ agent, sessionId: id }, () => provider.mutate(id, ws.dir, input));
        },
        '操作',
      );
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
