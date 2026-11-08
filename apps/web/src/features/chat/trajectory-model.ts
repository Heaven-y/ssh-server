import type { ChatItem } from './chat-reducer';
import { shortToolName, toolPrimaryArgument } from './tool-presentation';
import { activityStatus } from './activity-presentation';
import { tokenFields, formatTokens } from './chat-metrics';

export type TrajectoryItem = Exclude<ChatItem, { kind: 'fork-point' }>;
export type TrajectoryRow =
  | { kind: 'turn'; id: string; number: number; prompt?: string; user?: Extract<ChatItem, { kind: 'user' }> }
  | { kind: 'step'; id: string; number: number; item: TrajectoryItem };

/** 逐步骤虚拟化，单个长回合不会绕过列表的 DOM 预算。 */
export function projectTrajectory(items: ChatItem[]): TrajectoryRow[] {
  const rows: TrajectoryRow[] = [];
  let turn = 0;
  let step = 0;
  for (const item of items) {
    if (item.kind === 'fork-point') continue;
    if (item.kind === 'user' || turn === 0) {
      turn++;
      step = 0;
      rows.push({
        kind: 'turn',
        id: `turn:${item.id}`,
        number: turn,
        prompt: item.kind === 'user' ? item.text : undefined,
        user: item.kind === 'user' ? item : undefined,
      });
    }
    if (item.kind === 'user') continue;
    rows.push({ kind: 'step', id: `step:${item.id}`, number: ++step, item });
  }
  return rows;
}

export type TrajectoryRole = 'context' | 'user' | 'tool' | 'assistant';
export type TrajectoryFilter = 'all' | TrajectoryRole;
export const trajectoryRoles: Record<TrajectoryRole, string> = {
  context: '上下文',
  user: '用户',
  tool: '工具',
  assistant: '助手',
};

/** 保留原始顺序；角色与命令/读取等动作类型分别展示。 */
export function trajectoryRole(item: TrajectoryItem): TrajectoryRole {
  if (item.kind === 'compaction') return 'context';
  if (item.kind === 'user') return 'user';
  if (item.kind === 'tool' || item.kind === 'permission') return 'tool';
  return 'assistant';
}

export function filterTrajectory(rows: TrajectoryRow[], filter: TrajectoryFilter): TrajectoryRow[] {
  if (filter === 'all') return rows;
  if (filter === 'user') return rows.filter((row) => row.kind === 'turn' && !!row.user);
  const visible: TrajectoryRow[] = [];
  let turn: TrajectoryRow | undefined;
  for (const row of rows) {
    if (row.kind === 'turn') {
      turn = row;
      continue;
    }
    if (trajectoryRole(row.item) !== filter) continue;
    if (turn) {
      visible.push(turn);
      turn = undefined;
    }
    visible.push(row);
  }
  return visible;
}

const toolCategories = [
  { names: ['bash', 'shell', 'run_command', 'commandexecution', 'exec_command', 'execute_command'], label: '命令' },
  {
    names: ['edit', 'write', 'write_file', 'edit_file', 'apply_patch', 'filechange', 'replace', 'multi_edit'],
    label: '文件',
  },
  { names: ['read', 'read_file', 'view_file', 'list_files', 'list_directory', 'glob'], label: '读取' },
  { names: ['grep', 'search', 'search_files', 'websearch', 'web_search', 'webfetch', 'web_fetch'], label: '搜索' },
  { names: ['agent', 'task', 'collabagenttoolcall', 'subagentactivity', 'spawn_agent'], label: '子代理' },
  { names: ['plan', 'update_plan', 'todowrite'], label: '计划' },
];

export function trajectoryCategory(item: TrajectoryItem): string {
  if (item.kind !== 'tool') {
    const labels = {
      user: '消息',
      assistant: '回复',
      reasoning: '思考',
      permission: '审批',
      error: '错误',
      compaction: '压缩',
      statistics: '统计',
      activity: '活动',
    };
    return labels[item.kind];
  }
  if (item.name.startsWith('mcp__')) return 'MCP';
  const name = shortToolName(item.name).toLowerCase();
  return toolCategories.find((category) => category.names.includes(name))?.label ?? '工具';
}

export function trajectorySummary(item: TrajectoryItem): string {
  switch (item.kind) {
    case 'tool':
      return toolPrimaryArgument(item.input) || shortToolName(item.name);
    case 'activity':
      return item.name;
    case 'permission':
      return `${shortToolName(item.toolName)} ${toolPrimaryArgument(item.input) ?? ''}`.trim();
    case 'error':
      return item.message;
    case 'compaction':
      return compactionSummary(item);
    case 'statistics':
      return statisticsSummary(item);
    default:
      return item.text;
  }
}

function statisticsSummary(item: Extract<TrajectoryItem, { kind: 'statistics' }>) {
  const fields = tokenFields(item.usage)
    .map(({ label, value }) => `${label} ${formatTokens(value)}`)
    .join(' · ');
  return fields || (item.scope === 'turn' ? '回合统计' : '模型步骤统计');
}

function compactionSummary(item: Extract<TrajectoryItem, { kind: 'compaction' }>): string {
  return item.state.message ?? (item.state.trigger === 'manual' ? '手动压缩上下文' : '压缩上下文');
}

export function trajectoryStatus(item: TrajectoryItem): { label: string; tone: string } | undefined {
  if (item.kind === 'activity')
    return {
      label: activityStatus(item),
      tone: item.status === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
    };
  if (item.kind === 'tool') {
    if (item.status === 'running') return { label: '运行中', tone: 'text-muted-foreground' };
    if (item.status === 'incomplete') return { label: '未完成', tone: 'text-warning' };
    return item.isError
      ? { label: '失败', tone: 'text-destructive-foreground' }
      : { label: '完成', tone: 'text-success' };
  }
  return otherStatus(item);
}

function otherStatus(item: TrajectoryItem): { label: string; tone: string } | undefined {
  if (item.kind === 'permission') {
    const label = item.resolved ? { allow: '已批准', deny: '已拒绝', cancelled: '已取消' }[item.resolved] : '等待确认';
    return { label, tone: item.resolved ? 'text-muted-foreground' : 'text-warning' };
  }
  if (item.kind === 'assistant' && item.streaming) return { label: '生成中', tone: 'text-muted-foreground' };
  if (item.kind === 'error') return { label: '失败', tone: 'text-destructive-foreground' };
  if (item.kind !== 'compaction') return;
  const label = item.incomplete
    ? '未完成'
    : { running: '进行中', completed: '完成', failed: '失败', cancelled: '中断' }[item.state.status];
  return { label, tone: 'text-muted-foreground' };
}
