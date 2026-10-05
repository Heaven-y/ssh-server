import type { ChatItem } from './chat-reducer';

export type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
export type TimelineRow =
  { kind: 'message'; id: string; item: ChatItem } | { kind: 'read-group'; id: string; items: ToolItem[] };
export type ExpandedProps = { expanded?: boolean; onExpandedChange?(open: boolean): void };
/** 单行内部也必须有界，避免连续读取绕过外层虚拟列表。 */
const READ_GROUP_LIMIT = 40;

/** 只接受明确的读取/搜索工具；不根据shell命令猜测只读，remote_exec始终独立。 */
const READ_TOOLS = new Set([
  'read',
  'read_file',
  'grep',
  'glob',
  'search',
  'search_files',
  'list_directory',
  'list_files',
  'remote_peek',
]);
const isRead = (item: ChatItem): item is ToolItem =>
  item.kind === 'tool' && READ_TOOLS.has(item.name.split('__').at(-1)!.toLowerCase());

/** 投影不修改原始条目；遇到其他条目即结束组，保留所有审批/错误/压缩边界。 */
export function projectTimeline(items: ChatItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let reads: ToolItem[] = [];
  const message = (item: ChatItem): TimelineRow => ({ kind: 'message', id: `item:${item.id}`, item });
  const flush = () => {
    if (reads.length > 1) rows.push({ kind: 'read-group', id: `reads:${reads[0]!.id}`, items: reads });
    else if (reads.length) rows.push(message(reads[0]!));
    reads = [];
  };
  for (const item of items) {
    if (isRead(item)) {
      if (reads.length === READ_GROUP_LIMIT) flush();
      reads.push(item);
    } else {
      flush();
      rows.push(message(item));
    }
  }
  flush();
  return rows;
}

export function toolCounts(items: ToolItem[]) {
  return {
    running: items.filter((item) => item.status === 'running').length,
    incomplete: items.filter((item) => item.status === 'incomplete').length,
    failed: items.filter((item) => item.status === 'done' && item.isError).length,
    done: items.filter((item) => item.status === 'done' && !item.isError).length,
  };
}
