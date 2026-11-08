import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { claudeSessionActivity } from '../../../src/agents/claude/session-activity';

let root: string;
const sessionId = '11111111-1111-4111-8111-111111111111';
const cwd = path.join(tmpdir(), 'activity-workspace');
const updated = Date.parse('2026-11-08T04:00:00Z');
const record = { sessionId, cwd, summary: '演示会话', fileSize: 100, lastModified: updated };
const file = () => path.join(root, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
const line = (type: string, timestamp?: string, rest = {}) => JSON.stringify({ type, sessionId, timestamp, ...rest });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'claude-activity-'));
  await mkdir(path.dirname(file()), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true });
});

it('复制和元数据写入不改变对话时间，忽略子代理及尾部残缺行且不改原文件', async () => {
  const content = [
    line('user', '2026-11-01T11:00:00Z'),
    line('assistant', '2026-11-01T11:05:00Z'),
    line('assistant', '2026-11-08T03:00:00Z', { isSidechain: true }),
    line('assistant', '2026-11-08T03:00:00Z', { parent_tool_use_id: 'tool' }),
    line('assistant', '2026-11-08T03:00:00Z', { sessionId: 'foreign-session' }),
    line('custom-title', '2026-11-08T04:00:00Z'),
    line('cost-state', '2026-11-08T04:01:00Z'),
    '{"type":"assistant","timestamp":',
  ].join('\n');
  await writeFile(file(), content);
  expect(await claudeSessionActivity(record, { configDir: root })).toBe(Date.parse('2026-11-01T11:05:00Z'));
  expect(await readFile(file(), 'utf8')).toBe(content);
});

it('仅检查固定大小尾块，时间不在尾块或文件不可读时保留 SDK 值', async () => {
  await writeFile(file(), `${line('assistant', '2026-11-01T11:05:00Z')}\n${' '.repeat(512 * 1024)}\n`);
  expect(await claudeSessionActivity(record, { configDir: root })).toBe(updated);
  await writeFile(file(), `${' '.repeat(512 * 1024)}\n${line('user', '2026-11-02T11:05:00Z')}\n`);
  expect(await claudeSessionActivity(record, { configDir: root })).toBe(Date.parse('2026-11-02T11:05:00Z'));
  await rm(file());
  expect(await claudeSessionActivity(record, { configDir: root })).toBe(updated);
});

it('没有本地文件证据时不猜创建时间，取消请求保持取消状态', async () => {
  await writeFile(file(), line('assistant', '2026-11-01T11:05:00Z'));
  expect(await claudeSessionActivity({ ...record, fileSize: undefined }, { configDir: root })).toBe(updated);
  expect(await claudeSessionActivity({ ...record, cwd: undefined }, { configDir: root })).toBe(updated);
  expect(await claudeSessionActivity({ ...record, sessionId: '../unknown' }, { configDir: root })).toBe(updated);
  await expect(
    claudeSessionActivity(record, { configDir: root, signal: AbortSignal.abort(new Error('已取消')) }),
  ).rejects.toThrow('已取消');
});
