import {
  NativeSessionIdSchema,
  legacySessionCapabilities,
  type AgentKind,
  type SessionActionInput,
  type SessionCapabilities,
  type SessionForkInput,
  type SessionHistory,
  type SessionRef,
  type SessionSummary,
  type SessionPageQuery,
  type SubagentQuery,
  type SubagentRead,
  type PermissionSelection,
} from '@agentdeck/shared/conversation';
import { type Workspace } from '@agentdeck/shared/projects';
import { homedir } from 'node:os';
import { sameSessionDirectory, sessionDirectoryWithin } from '../agents/common/session-scope';
import type { SessionProvider } from '../agents/contracts';
import { SessionError } from '../agents/errors';
import { createSessionCatalog } from './catalog';
import { createSessionPaging, projectSummary } from './paging';
import { resolveProjectId } from '../agents/common/session-ownership';
import { SessionPreferencesError, type SessionPreferences } from './preferences';

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

type SessionOperations = {
  withIdleSession<T>(session: SessionRef, operation: () => Promise<T>): Promise<T>;
  /** 该原生会话是否正被本网页驱动；未接入时按未运行上报。 */
  isRunning?(session: SessionRef): boolean;
  /** 已配置项目列表，用于把原生会话归属到项目；省略时只按当前工作区判定。 */
  projects?(): Promise<Workspace[]>;
  preferences?: SessionPreferences;
};

async function safeOperation<T>(agent: AgentKind, operation: () => Promise<T>, verb = '读取'): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SessionError) throw error;
    if (error instanceof SessionPreferencesError) throw new SessionError(error.status, error.code, error.message);
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
  const paging = createSessionPaging();
  function capabilities(agent: AgentKind): SessionCapabilities {
    const actions = { ...legacySessionCapabilities(agent), ...providers[agent]?.capabilities };
    if (!actions.archive && operations.preferences) actions.archive = 'workbench';
    return actions;
  }
  async function projectsFor(ws?: Workspace) {
    return operations.projects ? operations.projects() : ws ? [ws] : [];
  }
  async function assertNotArchived(agent: AgentKind, id: string) {
    if (capabilities(agent).archive === 'workbench' && (await operations.preferences!.archived(agent)).has(id))
      throw new SessionError(409, 'session_archived', '请先恢复这条归档会话。');
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
      const actions = capabilities(agent);
      if (archived && !actions.archive)
        throw new SessionError(400, 'unsupported_action', `${AGENT_LABELS[agent]} 不支持归档会话`);
      const provider = providerOf(providers, agent);
      const nativeArchived = archived && actions.archive === 'native';
      // 全局枚举不依赖任何已登记目录仍然存在，也不加载某个项目作为发现范围。
      const sessions = await catalog.read(
        agent,
        nativeArchived,
        (abort) => provider.list(homedir(), abort, nativeArchived),
        signal,
      );
      const localArchives = actions.archive === 'workbench' ? await operations.preferences!.archived(agent) : undefined;
      const visible = localArchives
        ? sessions.filter((session) => localArchives.has(session.sessionId) === archived)
        : sessions;
      const projects = await projectsFor(ws);
      return visible.map((session) =>
        projectSummary(
          session,
          { query: { agent, scope: archived ? 'archived' : 'active' }, projects, actions },
          operations.isRunning?.({ agent, sessionId: session.sessionId }) ?? false,
        ),
      );
    });
  }
  async function permission(session: SessionRef): Promise<PermissionSelection | undefined> {
    return operations.preferences?.permission(session);
  }
  async function rememberPermission(session: SessionRef, selected: PermissionSelection | null): Promise<void> {
    if (selected && selected.agent !== session.agent)
      throw new SessionError(400, 'permission_agent_mismatch', '权限模式不属于当前 CLI');
    if (!operations.preferences)
      throw new SessionError(503, 'session_preferences_unavailable', '工作台会话偏好暂不可用');
    await operations.preferences.setPermission(session, selected);
  }
  return {
    invalidate: paging.invalidate,
    page(query: SessionPageQuery, signal?: AbortSignal) {
      return safeOperation(query.agent, async () => {
        const actions = capabilities(query.agent);
        if (query.scope === 'archived' && !actions.archive) return { items: [] };
        const projects = await projectsFor();
        if (query.projectId && !projects.some((project) => project.id === query.projectId))
          throw new SessionError(404, 'workspace_missing', '项目不存在');
        const archives =
          actions.archive === 'workbench' ? await operations.preferences!.archived(query.agent) : undefined;
        return paging.read(
          { query, projects, actions, archives },
          providerOf(providers, query.agent),
          (row) => operations.isRunning?.(row) ?? false,
          signal,
        );
      });
    },
    list(ws: Workspace, agent: AgentKind, signal?: AbortSignal, archived = false): Promise<SessionSummary[]> {
      return list(ws, agent, signal, archived);
    },
    async unassigned(agent: AgentKind, signal?: AbortSignal): Promise<SessionSummary[]> {
      return (await list(undefined, agent, signal)).filter((session) => session.projectId === null);
    },
    archived(agent: AgentKind, signal?: AbortSignal): Promise<SessionSummary[]> {
      return list(undefined, agent, signal, true);
    },
    read(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<SessionHistory> {
      return safeOperation(agent, async () => {
        const native = await scopedWorkspace(ws, agent, id, signal);
        await assertNotArchived(agent, id);
        const record = await providerOf(providers, agent).read(id, native.dir, signal);
        if (record.session.sessionId !== id || !(await sameSessionDirectory(record.cwd, native.dir)))
          throw new SessionError(404, 'session_missing', '该 Agent 在当前项目目录中没有此会话');
        return { session: { ...record.session, agent }, events: record.events, actualModel: record.actualModel };
      });
    },
    subagents(ws: Workspace, session: SessionRef, query: SubagentQuery, signal?: AbortSignal): Promise<SubagentRead> {
      return safeOperation(session.agent, async () => {
        const native = await scopedWorkspace(ws, session.agent, session.sessionId, signal);
        await assertNotArchived(session.agent, session.sessionId);
        const provider = providerOf(providers, session.agent);
        if (!provider.subagents) throw new SessionError(400, 'unsupported_action', '此 CLI 没有可读取的子代理历史接口');
        return provider.subagents(session.sessionId, native.dir, query, signal);
      });
    },
    assertBelongs(ws: Workspace, agent: AgentKind, id: string, signal?: AbortSignal): Promise<Workspace> {
      return safeOperation(agent, async () => {
        const native = await scopedWorkspace(ws, agent, id, signal);
        await assertNotArchived(agent, id);
        return native;
      });
    },
    // 仅供已经持有轮次锁并核实原生身份的 TurnManager 调用，避免再次取得空闲锁。
    permission,
    rememberPermission,
    readPermission(
      ws: Workspace,
      agent: AgentKind,
      id: string,
      signal?: AbortSignal,
    ): Promise<PermissionSelection | undefined> {
      return safeOperation(agent, async () => {
        await scopedWorkspace(ws, agent, id, signal);
        return permission({ agent, sessionId: id });
      });
    },
    setPermission(ws: Workspace, agent: AgentKind, id: string, permission: PermissionSelection | null): Promise<void> {
      return safeOperation(
        agent,
        () =>
          operations.withIdleSession({ agent, sessionId: id }, async () => {
            await scopedWorkspace(ws, agent, id);
            await rememberPermission({ agent, sessionId: id }, permission);
          }),
        '保存权限',
      );
    },
    fork(ws: Workspace, agent: AgentKind, id: string, input: SessionForkInput): Promise<SessionHistory['session']> {
      return safeOperation(
        agent,
        () =>
          operations.withIdleSession({ agent, sessionId: id }, async () => {
            // 提供方在锁内核验源与分叉点；原生返回后仍在锁内复核新身份。
            const native = await scopedWorkspace(ws, agent, id);
            await assertNotArchived(agent, id);
            const result = await providerOf(providers, agent).fork(id, native.dir, input);
            const newId = NativeSessionIdSchema.safeParse(result.session.sessionId);
            if (!newId.success || newId.data === id || !(await sameSessionDirectory(result.cwd, native.dir)))
              throw new SessionError(503, 'session_runtime_failed', '原生分叉返回了无效的新会话');
            return { ...result.session, agent };
          }),
        '分叉',
      ).finally(() => paging.invalidate(agent));
    },
    mutate(ws: Workspace, agent: AgentKind, id: string, input: SessionActionInput): Promise<void> {
      return safeOperation(
        agent,
        async () => {
          const provider = providerOf(providers, agent);
          const actions = capabilities(agent);
          const archiveAction = input.action === 'archive' || input.action === 'unarchive';
          if (archiveAction && !actions.archive)
            throw new SessionError(400, 'unsupported_action', `${AGENT_LABELS[agent]} 不支持归档会话`);
          await operations.withIdleSession({ agent, sessionId: id }, async () => {
            const native = await scopedWorkspace(ws, agent, id);
            if (archiveAction && actions.archive === 'workbench') {
              await operations.preferences!.setArchived({ agent, sessionId: id }, input.action === 'archive');
            } else {
              await provider.mutate(id, native.dir, input);
              // 原生删除已经成功；清理本地标记失败不能将已完成的删除报告成可重试失败。
              if (input.action === 'delete')
                await operations.preferences?.remove({ agent, sessionId: id }).catch(() => undefined);
            }
          });
        },
        '操作',
      ).finally(() => paging.invalidate(agent));
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
