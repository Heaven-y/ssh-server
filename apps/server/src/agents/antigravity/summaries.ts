import { DatabaseSync } from 'node:sqlite';
import type { NativeSessionPageInput } from '../contracts';

/** Antigravity 摘要表的一行；字段名保持数据库原样，映射交给会话提供方。 */
export type SummaryRow = {
  conversationId: string;
  title: string;
  workspaceUris: string;
  lastModified: string;
  preview: string;
};

// Antigravity 自己维护的元数据表；字段名以本机实测库为准，不读取原始轨迹。
const BASE_COLUMNS = ['conversation_id', 'title', 'preview', 'last_modified_time', 'workspace_uris'];

/**
 * 除了用户会话，表里还有几类不该出现在列表里的行：
 *   - `parent_conversation_id` 非空 / `nesting_depth` > 0：子会话（内部子代理）
 *   - `battle_id` 非空：多个候选之间的对战比较
 * Codex 那边同样排除内部子代理（`agents/codex/sessions.ts` 的 `internalSubagent`），这里保持一致：
 * 用户要看的是自己的会话，不是 CLI 的内部调度产物。
 *
 * 这些列在不同版本的表里未必都存在，所以先用 pragma 探测，只对确实存在的列加条件——
 * 缺列时退化为不做该维度过滤，而不是让整条查询报错、列表变空。
 */
const FILTERS: { column: string; clause: string }[] = [
  { column: 'parent_conversation_id', clause: "coalesce(parent_conversation_id, '') = ''" },
  { column: 'nesting_depth', clause: 'coalesce(nesting_depth, 0) <= 0' },
  { column: 'battle_id', clause: "coalesce(battle_id, '') = ''" },
];

function queryFor(columns: Set<string>): string {
  const filters = [
    "trim(coalesce(cast(conversation_id as text), '')) <> ''",
    "trim(coalesce(cast(last_modified_time as text), '')) <> ''",
    ...FILTERS.filter((filter) => columns.has(filter.column)).map((filter) => filter.clause),
  ];
  const where = filters.length ? `\nwhere ${filters.join('\n  and ')}` : '';
  return `select ${BASE_COLUMNS.join(', ')}\nfrom conversation_summaries${where}\norder by last_modified_time desc`;
}

/** 读表里实际有哪些列；读不到时按「没有任何可过滤列」处理。 */
function tableColumns(db: DatabaseSync): Set<string> {
  try {
    const info = db.prepare('pragma table_info(conversation_summaries)').all();
    const names = info
      .map((row) => (row as Record<string, unknown>).name)
      .filter((name): name is string => typeof name === 'string');
    return new Set(names);
  } catch {
    return new Set();
  }
}

/** SQLite 的 TEXT/INTEGER 都可能出现在列里，统一收敛成字符串；NULL 或对象视为缺失。 */
function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}

function toSummaryRow(value: unknown): SummaryRow | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const conversationId = cell(row, 'conversation_id').trim();
  const lastModified = cell(row, 'last_modified_time').trim();
  // 会话 id 与时间是列表排序的必需项；缺失时跳过该行，不伪造一条记录。
  if (!conversationId || !lastModified) return undefined;
  return {
    conversationId,
    title: cell(row, 'title'),
    workspaceUris: cell(row, 'workspace_uris'),
    lastModified,
    preview: cell(row, 'preview'),
  };
}

/**
 * 只读读取 Antigravity 的会话摘要。
 * 库不存在、表结构变化、文件损坏或锁冲突都按「没有可展示的会话」处理，绝不向调用方抛错。
 */
export function readSummaries(dbPath: string, page?: NativeSessionPageInput): SummaryRow[] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const sql = queryFor(tableColumns(db));
    const rows = page
      ? db.prepare(`${sql}, conversation_id asc limit ? offset ?`).all(page.limit, Number(page.cursor ?? 0))
      : db.prepare(sql).all();
    const result: SummaryRow[] = [];
    for (const row of rows) {
      const summary = toSummaryRow(row);
      if (summary) result.push(summary);
    }
    return result;
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // 关闭失败不影响已经读到的结果，也不把异常抛给列表调用方。
    }
  }
}
