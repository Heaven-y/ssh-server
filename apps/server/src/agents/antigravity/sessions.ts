import { homedir } from 'node:os';
import path from 'node:path';
import type { SessionProvider } from '../../chat/sessions';
import { SessionError } from '../../chat/sessions';
import type { NativeSessionSummary } from '../types';
import { readSummaries, type SummaryRow } from './summaries';

/** Antigravity 在用户目录下维护自己的会话摘要库，不随项目目录变化。 */
export const ANTIGRAVITY_DB_PATH = path.join(homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db');

export type AntigravitySessionsApi = {
  dbPath: string;
  readSummaries(dbPath: string): SummaryRow[];
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
 * Antigravity 目前只暴露会话元数据：历史轨迹是私有格式，M1 不伪造回合事件。
 * 列表读取失败时降级为空，避免一个库的问题拖垮整个会话面板。
 */
export function createAntigravitySessions(api: Partial<AntigravitySessionsApi> = {}): SessionProvider {
  const dbPath = api.dbPath ?? ANTIGRAVITY_DB_PATH;
  const read = api.readSummaries ?? readSummaries;

  function rows(): SummaryRow[] {
    try {
      return read(dbPath);
    } catch {
      return [];
    }
  }

  return {
    list(_dir, _signal, archived = false) {
      if (archived) return Promise.reject(new SessionError(400, 'unsupported_action', 'Antigravity 不支持归档会话'));
      return Promise.resolve(rows().map(nativeSummary));
    },
    read() {
      return Promise.reject(
        new SessionError(
          501,
          'session_not_replayable',
          'Antigravity 的会话历史以私有轨迹格式保存在本机，当前无法读取；可以继续对话。',
        ),
      );
    },
    assertBelongs(id) {
      if (rows().some((row) => row.conversationId === id)) return Promise.resolve();
      return Promise.reject(new SessionError(404, 'session_missing', 'Antigravity 在当前工作区中没有此会话'));
    },
    mutate() {
      return Promise.reject(new SessionError(400, 'unsupported_action', 'Antigravity 会话暂不支持重命名、归档或删除'));
    },
    fork() {
      return Promise.reject(new SessionError(400, 'unsupported_action', 'Antigravity 会话暂不支持分叉'));
    },
  };
}
