import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { z } from 'zod';
import type {
  AgentKind,
  SessionCapabilities,
  SessionPage,
  SessionPageQuery,
  SessionSummary,
} from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import type { NativeSessionPage, NativeSessionRow, SessionProvider } from '../agents/contracts';
import { SessionError } from '../agents/errors';
import { nativeSessionDirectory, resolveProjectId } from '../agents/common/session-ownership';
import { createSessionPageCache } from './page-cache';

export const SESSION_PAGE_SIZE = 50;
const SCAN_PAGES = 8;
const AGENT_SEARCH_NAMES = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity AGY' };
const Cursor = z
  .object({
    key: z.string(),
    revision: z.string(),
    native: z.string().optional(),
    offset: z.number().int().min(0).max(50),
  })
  .strict();
type Position = z.infer<typeof Cursor>;
type Context = { query: SessionPageQuery; projects: Workspace[]; archives?: Set<string>; actions: SessionCapabilities };
const expired = () => new SessionError(409, 'session_page_expired', '会话列表已更新，请重新读取。');
const fingerprint = (context: Context) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        context.query.agent,
        context.query.scope,
        context.query.projectId,
        context.query.reader,
        context.query.search?.trim().toLocaleLowerCase(),
        context.projects.map(({ id, dir, name }) => [id, dir, name]),
      ]),
    )
    .digest('hex');

function position(context: Context, revision: string): Position {
  const key = fingerprint(context);
  if (!context.query.cursor) return { key, revision, offset: 0 };
  try {
    const value = Cursor.parse(JSON.parse(Buffer.from(context.query.cursor, 'base64url').toString('utf8')));
    if (value.key !== key || value.revision !== revision) throw expired();
    return value;
  } catch {
    throw expired();
  }
}

export function projectSummary(
  row: NativeSessionRow,
  context: Pick<Context, 'query' | 'projects' | 'actions'>,
  running: boolean,
): SessionSummary {
  const location = {
    ...(context.query.agent === 'antigravity' ? {} : { cwd: row.cwd }),
    workspaceUris: row.workspaceUris,
  };
  return {
    agent: context.query.agent,
    sessionId: row.sessionId,
    projectId: resolveProjectId({ ...location, projects: context.projects }),
    title: row.summary,
    updatedAt: new Date(row.lastModified).toISOString(),
    running,
    directory: nativeSessionDirectory(location),
    capabilities: context.actions,
  };
}
function scopeMatches(item: SessionSummary, context: Context) {
  const { query, archives } = context;
  if (archives && archives.has(item.sessionId) !== (query.scope === 'archived')) return false;
  if (query.scope === 'active' && item.projectId === null) return false;
  if (query.scope === 'unassigned' && item.projectId !== null) return false;
  return !query.projectId || item.projectId === query.projectId;
}
function matches(item: SessionSummary, context: Context) {
  if (!scopeMatches(item, context)) return false;
  const text = context.query.search?.trim().toLocaleLowerCase();
  const project = context.projects.find((project) => project.id === item.projectId);
  return (
    !text ||
    `${item.title} ${item.sessionId} ${item.directory ?? ''} ${project?.name ?? ''} ${item.agent} ${AGENT_SEARCH_NAMES[item.agent]}`
      .toLocaleLowerCase()
      .includes(text)
  );
}
type Scan = { pos: Position; result: SessionSummary[]; seen: Set<string>; cursors: Set<string> };
function appendPage(scan: Scan, page: NativeSessionPage, context: Context, running: (row: SessionSummary) => boolean) {
  if (page.items.length > SESSION_PAGE_SIZE) throw new Error('原生摘要分页超过请求数量');
  let index = scan.pos.offset;
  for (; index < page.items.length && scan.result.length < SESSION_PAGE_SIZE; index++) {
    const item = projectSummary(page.items[index]!, context, false);
    item.running = running(item);
    if (!matches(item, context) || scan.seen.has(item.sessionId)) continue;
    scan.seen.add(item.sessionId);
    scan.result.push(item);
  }
  return index;
}
function advance(scan: Scan, page: NativeSessionPage, index: number) {
  if (index < page.items.length) {
    scan.pos.offset = index;
    return true;
  }
  const next = page.nextCursor;
  if (next && (next === scan.pos.native || scan.cursors.has(next))) throw new Error('原生会话分页游标重复');
  if (next) scan.cursors.add(next);
  scan.pos.native = next;
  scan.pos.offset = 0;
  return next !== undefined;
}

/** 原生页大小固定，筛选后不够一页时有限向后扫描，再把游标交回页面。 */
export function createSessionPaging() {
  const cache = createSessionPageCache();
  async function nativePage(
    provider: SessionProvider,
    source: { agent: AgentKind; archived: boolean; cursor?: string; reader?: string },
    signal?: AbortSignal,
  ) {
    return cache.read(
      source,
      async (abort): Promise<NativeSessionPage> => {
        if (provider.page)
          return provider.page(homedir(), { limit: SESSION_PAGE_SIZE, cursor: source.cursor }, abort, source.archived);
        // 仅旧提供方兼容；三个内置 CLI 均实现原生分页。
        const rows = await provider.list(homedir(), abort, source.archived);
        const offset = Number(source.cursor ?? 0);
        const items = rows.slice(offset, offset + SESSION_PAGE_SIZE);
        return { items, nextCursor: offset + items.length < rows.length ? String(offset + items.length) : undefined };
      },
      signal,
    );
  }
  return {
    invalidate: (agent: AgentKind) => cache.invalidate(agent),
    async read(
      context: Context,
      provider: SessionProvider,
      running: (row: SessionSummary) => boolean,
      signal?: AbortSignal,
    ): Promise<SessionPage> {
      const { query } = context;
      const pos = position(context, cache.revision(query.agent));
      const scan: Scan = { pos, result: [], seen: new Set(), cursors: new Set() };
      let more = true;
      const archived = query.scope === 'archived' && context.actions.archive === 'native';
      for (let scanned = 0; scanned < SCAN_PAGES && more && scan.result.length < SESSION_PAGE_SIZE; scanned++) {
        signal?.throwIfAborted();
        const page = await nativePage(
          provider,
          { agent: query.agent, archived, cursor: pos.native, reader: query.reader },
          signal,
        );
        if (cache.revision(query.agent) !== pos.revision) throw expired();
        more = advance(scan, page, appendPage(scan, page, context, running));
      }
      return {
        items: scan.result,
        ...(more ? { nextCursor: Buffer.from(JSON.stringify(pos)).toString('base64url') } : {}),
      };
    },
  };
}
