// 从原生工具事件聚合本轮文件变更；不读取工作区，也不创建 Git 对象。
import type { AgentKind, TurnFileChange } from '@ssh-server/shared';

type Change = TurnFileChange;
const MAX_DIFF_CHARS = 200_000;

/** 统计 unified diff 的新增与删除行数；无法解析时返回 null。 */
function countDiff(diff: string): { additions: number; deletions: number } | null {
  if (!diff) return null;
  let additions = 0;
  let deletions = 0;
  let seen = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('@@')) {
      seen = true;
      continue;
    }
    if (!seen) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return seen ? { additions, deletions } : null;
}

function lineCount(value: string): number {
  return value ? value.split('\n').length : 0;
}

/** 用 old/new 文本合成可直接展示的 unified diff。 */
function textDiff(path: string, before: string, after: string): string {
  const removed = before ? before.split('\n').map((line) => `-${line}`) : [];
  const added = after ? after.split('\n').map((line) => `+${line}`) : [];
  return [`--- a/${path}`, `+++ b/${path}`, ...removed, ...added].join('\n');
}

function bounded(diff: string): string {
  return diff.length <= MAX_DIFF_CHARS ? diff : `${diff.slice(0, MAX_DIFF_CHARS)}\n[已截断]`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Claude 的 Edit / Write / NotebookEdit；只有 Edit 能给出真实前后文。 */
function claudeChanges(name: string, input: Record<string, unknown>): Change[] {
  const path = str(input.file_path) || str(input.notebook_path);
  if (!path) return [];
  if (name === 'Edit') {
    const before = str(input.old_string);
    const after = str(input.new_string);
    return [
      {
        path,
        kind: 'modified',
        additions: lineCount(after),
        deletions: lineCount(before),
        binary: false,
        diff: bounded(textDiff(path, before, after)),
        viaTool: true,
      },
    ];
  }
  if (name === 'Write') {
    const content = str(input.content);
    return [
      {
        path,
        kind: 'modified',
        additions: lineCount(content),
        deletions: null,
        binary: false,
        diff: bounded(textDiff(path, '', content)),
        viaTool: true,
      },
    ];
  }
  return [{ path, kind: 'modified', additions: null, deletions: null, binary: false, viaTool: true }];
}

/** Codex 的 fileChange 自带每个文件的 unified patch。 */
function codexChange(value: unknown): Change | undefined {
  const change = record(value);
  const path = str(change.path);
  if (!path) return;
  const diff = str(change.diff);
  const counts = countDiff(diff);
  return {
    path,
    kind: diff.includes('+++ /dev/null') ? 'deleted' : 'modified',
    additions: counts?.additions ?? null,
    deletions: counts?.deletions ?? null,
    binary: !diff,
    ...(diff ? { diff: bounded(diff) } : {}),
    viaTool: true,
  };
}

function codexChanges(input: Record<string, unknown>): Change[] {
  const changes = Array.isArray(input.changes) ? input.changes : [];
  return changes.map(codexChange).filter((value): value is Change => value !== undefined);
}

/** 只接受编辑类工具；其他工具（命令、搜索）不参与文件变更汇总。 */
export function toolFileChanges(agent: AgentKind, name: string, input: unknown): Change[] {
  const value = record(input);
  if (agent === 'codex') return name === 'fileChange' ? codexChanges(value) : [];
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') return claudeChanges(name, value);
  return [];
}

/** 同一文件多次编辑时合并，保留最后一次的 diff 并累加行数。 */
export function mergeChanges(into: Map<string, Change>, next: Change[]): void {
  for (const change of next) {
    const previous = into.get(change.path);
    if (!previous) {
      into.set(change.path, change);
      continue;
    }
    into.set(change.path, {
      ...change,
      additions:
        previous.additions === null || change.additions === null ? null : previous.additions + change.additions,
      deletions:
        previous.deletions === null || change.deletions === null ? null : previous.deletions + change.deletions,
    });
  }
}

/** 补齐状态对比发现、但没有原生 diff 的文件（例如由命令修改）。 */
export function withDetected(changes: Map<string, Change>, detected: string[]): Change[] {
  for (const path of detected) {
    if (changes.has(path)) continue;
    changes.set(path, { path, kind: 'modified', additions: null, deletions: null, binary: false, viaTool: false });
  }
  return [...changes.values()].sort((left, right) => left.path.localeCompare(right.path));
}
