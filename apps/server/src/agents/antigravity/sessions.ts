import { NativeSessionIdSchema } from '@agentdeck/shared/conversation';
import { homedir } from 'node:os';
import path from 'node:path';
import { nativeSessionDirectory, resolveProjectId } from '../common/session-ownership';
import { sameSessionDirectory } from '../common/session-scope';
import type { NativeSessionSummary, SessionProvider, NativeSessionPageInput } from '../contracts';
import { SessionError } from '../errors';
import { antigravityHistory } from './history';
import type { AntigravitySessionManagement } from './session-management-types';
import { readSummaries, type SummaryRow } from './summaries';

/** Antigravity 在用户目录下维护自己的会话摘要库，不随项目目录变化。 */
export const ANTIGRAVITY_DB_PATH = path.join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db');

export type AntigravitySessionsApi = {
  dbPath: string;
  readSummaries(dbPath: string, page?: NativeSessionPageInput): SummaryRow[];
  management?: AntigravitySessionManagement;
};

function epochMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  // 列声明是 datetime，但 SQLite 类型宽松：若哪天存成整数秒或毫秒，直接拼 Z 会得到 NaN，
  // 于是所有行都显示 1970。10 位按秒、13 位按毫秒；其它纯数字按数量级猜，别静默回 0。
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return trimmed.length <= 11 ? n * 1_000 : n;
  }
  // SQLite 的 datetime 不带时区时按 UTC 解读，避免同一份库在不同时区显示成不同时间。
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed) ? trimmed.replace(' ', 'T') : trimmed;
  const parsed = Date.parse(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function nativeSummary(row: SummaryRow): NativeSessionSummary {
  return {
    sessionId: row.conversationId,
    summary: row.title.trim() || '未命名会话',
    lastModified: epochMs(row.lastModified),
    // 原样带出，归属裁决由上层按 workspace_uris 决定，这里不做猜测。
    workspaceUris: row.workspaceUris,
  };
}

/**
 * 摘要来自原生 SQLite；正文经已核验身份的原生轨迹接口读取，不维护第二份会话。
 * 列表读取失败时降级为空，避免一个库的问题拖垮整个会话面板。
 */
export function createAntigravitySessions(api: Partial<AntigravitySessionsApi> = {}): SessionProvider {
  const dbPath = api.dbPath ?? ANTIGRAVITY_DB_PATH;
  const read = api.readSummaries ?? readSummaries;

  function rows(page?: NativeSessionPageInput): SummaryRow[] {
    try {
      return read(dbPath, page);
    } catch {
      return [];
    }
  }

  function belongs(id: string, dir: string): SummaryRow {
    const found = rows().find((row) => row.conversationId === id);
    if (
      found &&
      resolveProjectId({ workspaceUris: found.workspaceUris, projects: [{ id: 'current', name: '', dir }] }) ===
        'current'
    )
      return found;
    throw new SessionError(404, 'session_missing', 'Antigravity 在当前工作区中没有此会话');
  }

  return {
    capabilities: {
      rename: !!api.management?.rename,
      fork: api.management ? 'native' : null,
      delete: api.management ? 'native' : null,
    },
    list(_dir, _signal, archived = false) {
      if (archived) return Promise.reject(new SessionError(400, 'unsupported_action', 'Antigravity 不支持归档会话'));
      return Promise.resolve(rows().map(nativeSummary));
    },
    page(_dir, page, signal, archived = false) {
      signal?.throwIfAborted();
      if (archived) return Promise.reject(new SessionError(400, 'unsupported_action', 'Antigravity 不支持原生归档'));
      const entries = rows(page);
      return Promise.resolve({
        items: entries.map(nativeSummary),
        nextCursor: entries.length === page.limit ? String(Number(page.cursor ?? 0) + page.limit) : undefined,
      });
    },
    async read(id, dir, signal) {
      signal?.throwIfAborted();
      const found = belongs(id, dir);
      if (!api.management?.readTrajectory)
        throw new SessionError(503, 'session_runtime_failed', 'Antigravity 历史读取服务尚未就绪。');
      const cwd = nativeSessionDirectory({ workspaceUris: found.workspaceUris });
      if (!cwd || !(await sameSessionDirectory(cwd, dir)))
        throw new SessionError(404, 'session_missing', 'Antigravity 会话的目录不匹配');
      const { trajectory } = await api.management.readTrajectory(id, cwd, signal);
      signal?.throwIfAborted();
      if (trajectory.cascadeId !== id)
        throw new SessionError(404, 'session_missing', 'Antigravity 返回的会话身份不匹配');
      return { session: nativeSummary(found), cwd, events: antigravityHistory(trajectory) };
    },
    assertBelongs(id, dir, signal) {
      signal?.throwIfAborted();
      return Promise.resolve().then(() => {
        const found = belongs(id, dir);
        return {
          cwd: nativeSessionDirectory({ workspaceUris: found.workspaceUris }) ?? dir,
          workspaceUris: found.workspaceUris,
        };
      });
    },
    async mutate(id, dir, input) {
      if (!api.management || input.action === 'archive' || input.action === 'unarchive')
        throw new SessionError(400, 'unsupported_action', '此 Antigravity 会话操作尚不可用');
      belongs(id, dir);
      if (input.action === 'rename') {
        if (!api.management.rename) throw new SessionError(400, 'unsupported_action', 'Antigravity 重命名尚不可用');
        return api.management.rename(id, dir, input.title);
      }
      return api.management.delete(id, dir);
    },
    async fork(id, dir, input) {
      if (!api.management) throw new SessionError(400, 'unsupported_action', 'Antigravity 创建分支尚不可用');
      belongs(id, dir);
      const created = await api.management.fork(id, dir, input);
      if (!NativeSessionIdSchema.safeParse(created.sessionId).success || created.sessionId === id)
        throw new SessionError(503, 'session_runtime_failed', 'Antigravity 未返回有效的新会话');
      const found = rows().find((row) => row.conversationId === created.sessionId);
      const cwd = found && nativeSessionDirectory({ workspaceUris: found.workspaceUris });
      if (!found || !cwd || !(await sameSessionDirectory(cwd, dir)))
        throw new SessionError(503, 'session_runtime_failed', 'Antigravity 新会话的目录不匹配');
      return { session: nativeSummary(found), cwd };
    },
  };
}
