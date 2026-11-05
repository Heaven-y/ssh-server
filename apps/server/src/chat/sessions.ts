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
import type { NativeSessionFork, NativeSessionRead, NativeSessionRow } from '../agents/types';
import { homedir } from 'node:os';
import { sameSessionDirectory, sessionDirectoryWithin } from '../agents/session-scope';
import { nativeSessionDirectory, resolveProjectId } from '../sessions/ownership';
import { createSessionCatalog } from './session-catalog';

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

export type SessionProvider = {
  list(dir: string, signal?: AbortSignal, archived?: boolean): Promise<NativeSessionRow[]>;
  read(id: string, dir: string, signal?: AbortSignal): Promise<NativeSessionRead>;
  /** 返回已核实的原生目录；多目录 CLI 同时保留完整归属元数据。 */
  assertBelongs(
    id: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<void | string | { cwd: string; workspaceUris: string }>;
  mutate(id: string, dir: string, input: SessionActionInput): Promise<void>;
  fork(id: string, dir: string, input: SessionForkInput): Promise<NativeSessionFork>;
};
type SessionOperations = {
  withIdleSession<T>(session: SessionRef, operation: () => Promise<T>): Promise<T>;
  /** 该原生会话是否正被本网页驱动；未接入时按未运行上报。 */
  isRunning?(session: SessionRef): boolean;
  /** 已配置项目列表，用于把原生会话归属到项目；省略时只按当前工作区判定。 */
  projects?(): Promise<Workspace[]>;
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
  const catalog = createSessionCatalog();
  async function projectsFor(ws?: Workspace) {
    return operations.projects ? operations.projects() : ws ? [ws] : [];
  }
  async function scopedWorkspace(
    ws: Workspace,
    agent: AgentKind,
    id: string,
    signal?: AbortSignal,
  ): Promise<Workspace> {
    signal?.throwIfAborted();
    const scope = await providerOf(providers, agent).assertBelongs(id, ws.dir, signal);
    signal?.throwIfAborted();
    if (scope === undefined) return ws;
    const location = typeof scope === 'string' ? { cwd: scope } : scope;
    const directory = location.cwd;
    const projects = await projectsFor(ws);
    const ownership = 'workspaceUris' in location ? { workspaceUris: location.workspaceUris } : { cwd: directory };
    if (!sessionDirectoryWithin(directory, ws.dir) || resolveProjectId({ ...ownership, projects }) !== ws.id)
      throw new SessionError(404, 'session_missing', '该 Agent 在当前项目目录中没有此会话');
    return { ...ws, dir: directory };
  }
  async function list(
    ws: Workspace | undefined,
    agent: AgentKind,
    signal?: AbortSignal,
    archived = false,
  ): Promise<SessionSummary[]> {
    return safeOperation(agent, async () => {
      const provider = providerOf(providers, agent);
      if (archived && agent !== 'codex')
        throw new SessionError(400, 'unsupported_action', `${AGENT_LABELS[agent]} 不支持归档会话`);
      // 全局枚举不依赖任何已登记目录仍然存在，也不加载某个项目作为发现范围。
      const sessions = await catalog.read(
        agent,
        archived,
        (abort) => provider.list(homedir(), abort, archived),
        signal,
      );
      const projects = await projectsFor(ws);
      return sessions.map((session) => {
        const location = {
          ...(agent === 'antigravity' ? {} : { cwd: session.cwd }),
          workspaceUris: session.workspaceUris,
        };
        return {
          agent,
          sessionId: session.sessionId,
          projectId: resolveProjectId({ ...location, projects }),
          title: session.summary,
          updatedAt: new Date(session.lastModified).toISOString(),
          running: operations.isRunning?.({ agent, sessionId: session.sessionId }) ?? false,
          directory: nativeSessionDirectory(location),
        };
      });
    });
  }
  return {
    list(ws: Workspace, agent: AgentKind, signal?: AbortSignal, archived = false): Promise<SessionSummary[]> {
      return list(ws, agent, signal, archived);
    },
    async unassigned(agent: AgentKind, signal?: AbortSignal): Promise<SessionSummary[]> {
      return (await list(undefined, agent, signal)).filter((session) => session.projectId === null);
    },
    read(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<SessionHistory> {
      return safeOperation(agent, async () => {
        const native = await scopedWorkspace(ws, agent, id, signal);
        const record = await providerOf(providers, agent).read(id, native.dir, signal);
        if (record.session.sessionId !== id || !(await sameSessionDirectory(record.cwd, native.dir)))
          throw new SessionError(404, 'session_missing', '该 Agent 在当前项目目录中没有此会话');
        return { session: { ...record.session, agent }, events: record.events, actualModel: record.actualModel };
      });
    },
    assertBelongs(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<Workspace> {
      return safeOperation(agent, () => scopedWorkspace(ws, agent, id, signal));
    },
    fork(ws: Workspace, agent: AgentKind, id: string, input: SessionForkInput): Promise<SessionHistory['session']> {
      return safeOperation(
        agent,
        () =>
          operations.withIdleSession({ agent, sessionId: id }, async () => {
            // 提供方在锁内核验源与分叉点；原生返回后仍在锁内复核新身份。
            const native = await scopedWorkspace(ws, agent, id);
            const result = await providerOf(providers, agent).fork(id, native.dir, input);
            const newId = NativeSessionIdSchema.safeParse(result.session.sessionId);
            if (!newId.success || newId.data === id || !(await sameSessionDirectory(result.cwd, native.dir)))
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
          await operations.withIdleSession({ agent, sessionId: id }, async () => {
            const native = await scopedWorkspace(ws, agent, id);
            await provider.mutate(id, native.dir, input);
          });
        },
        '操作',
      );
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
