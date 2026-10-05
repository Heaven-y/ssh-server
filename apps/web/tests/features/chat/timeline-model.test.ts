import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../../src/features/chat/chat-reducer';
import { projectTimeline, toolCounts, type ToolItem } from '../../../src/features/chat/timeline-model';

const tool = (id: string, name = 'Read', status: ToolItem['status'] = 'done', isError = false): ToolItem => ({
  kind: 'tool',
  id,
  name,
  input: { path: 'src/example.py' },
  output: '示例结果',
  status,
  isError,
});

describe('对话时间线投影', () => {
  it('保留原条目、顺序及审批/错误/用户/压缩边界，不把执行或未知工具合并', () => {
    const boundary: ChatItem[] = [
      tool('exec', 'mcp__ssh-server__remote_exec'),
      tool('unknown', 'commandExecution'),
      { kind: 'permission', id: 'permission', toolName: 'Read', input: {} },
      { kind: 'error', id: 'error', message: '失败' },
      { kind: 'user', id: 'user', text: '下一轮' },
      { kind: 'compaction', id: 'compact', state: { status: 'completed' } },
    ];
    const source = [tool('a'), tool('b', 'mcp__ssh-server__remote_peek'), ...boundary, tool('c', 'Grep')];
    const rows = projectTimeline(source);
    expect(rows[0]).toMatchObject({ kind: 'read-group', items: source.slice(0, 2) });
    expect(rows.slice(1).map((row) => row.kind === 'message' && row.item)).toEqual(source.slice(2));
    if (rows[0]?.kind === 'read-group') expect(rows[0].items[0]).toBe(source[0]);
    expect(source).toHaveLength(9);
  });

  it('运行、失败和未返回分别计数，不因合并标成完成', () => {
    expect(
      toolCounts([
        tool('done'),
        tool('failed', 'Read', 'done', true),
        tool('run', 'Read', 'running'),
        tool('missing', 'Read', 'incomplete'),
      ]),
    ).toEqual({ done: 1, failed: 1, running: 1, incomplete: 1 });
  });

  it('流式追加和结果更新保持已有组key，单项仍是原消息', () => {
    const a = tool('a');
    const b = tool('b', 'Read', 'running');
    expect(projectTimeline([a])[0]).toMatchObject({ kind: 'message', item: a });
    const before = projectTimeline([a, b]);
    expect(projectTimeline([a, { ...b, status: 'done' }, tool('c')])[0]?.id).toBe(before[0]?.id);
  });

  it('1000次连续读取分成最多40项的稳定行，原工具不遗漏', () => {
    const source = Array.from({ length: 1000 }, (_, i) => tool(`read-${i}`));
    const rows = projectTimeline(source);
    expect(rows).toHaveLength(25);
    expect(rows.every((row) => row.kind === 'read-group' && row.items.length <= 40)).toBe(true);
    expect(rows.flatMap((row) => (row.kind === 'read-group' ? row.items : [row.item]))).toEqual(source);
    expect(
      projectTimeline([...source, tool('next')])
        .slice(0, 25)
        .map((row) => row.id),
    ).toEqual(rows.map((row) => row.id));
  });
});
