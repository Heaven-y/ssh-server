import { describe, expect, it } from 'vitest';
import { formatDenied, formatExecResult } from './tools';

const base = { stdout: '', stderr: '', exitCode: 0, timedOut: false, truncated: false, durationMs: 12 };

describe('formatExecResult', () => {
  it('包含退出码与 stdout', () => {
    const text = formatExecResult({ ...base, stdout: 'h1\n' });
    expect(text).toContain('退出码：0');
    expect(text).toContain('h1');
  });

  it('超时与截断时给出说明', () => {
    const text = formatExecResult({ ...base, exitCode: null, timedOut: true, truncated: true, stderr: 'oops' });
    expect(text).toContain('已超时');
    expect(text).toContain('已截断');
    expect(text).toContain('oops');
  });
});

describe('formatDenied', () => {
  it('说明拒绝原因和规则', () => {
    expect(formatDenied({ ruleId: 'privilege', reason: '禁止提权命令' })).toBe('命令被拒绝：禁止提权命令（规则 privilege）');
  });
});
