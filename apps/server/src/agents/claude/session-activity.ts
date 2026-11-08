import { lstat, open, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';

const MAX_TAIL_BYTES = 256 * 1024;
const MAX_PROJECT_KEY_LENGTH = 200;
type ActivityOptions = { configDir?: string; signal?: AbortSignal };
type Entry = Record<string, unknown>;

function mainDialogue(entry: Entry, sessionId: string): boolean {
  if (!entry || (entry.type !== 'user' && entry.type !== 'assistant')) return false;
  if (entry.isSidechain || entry.parent_tool_use_id || entry.parent_agent_id) return false;
  return typeof entry.sessionId !== 'string' || entry.sessionId === sessionId;
}

function entryTime(line: string, sessionId: string): number | undefined {
  let entry: Entry;
  try {
    entry = JSON.parse(line) as Entry;
  } catch {
    return;
  }
  if (!mainDialogue(entry, sessionId)) return;
  if (typeof entry.timestamp !== 'string') return;
  const time = Date.parse(entry.timestamp);
  return Number.isFinite(time) ? time : undefined;
}

async function optionalTime(file: string, sessionId: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    return await readTime(file, sessionId, signal);
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

function localRecord(record: SDKSessionInfo): boolean {
  return !!record.cwd && record.fileSize !== undefined && /^[a-f0-9-]{36}$/i.test(record.sessionId);
}

function configDirectory(configDir?: string): string {
  return configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
}

function tailTime(content: string, sessionId: string, truncated: boolean): number | undefined {
  const lines = content.split('\n');
  // 固定长度尾块可能从一条消息中间开始，不解析这条残缺记录。
  if (truncated) lines.shift();
  for (let index = lines.length - 1; index >= 0; index--) {
    const time = entryTime(lines[index]!, sessionId);
    if (time !== undefined) return time;
  }
  return undefined;
}

async function projectDirectories(root: string, cwd: string): Promise<string[]> {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (key.length <= MAX_PROJECT_KEY_LENGTH) return [path.join(root, key)];
  // 长项目键由原生追加散列；只枚举匹配前缀的目录，不复制 SDK 的散列实现。
  const prefix = key.slice(0, MAX_PROJECT_KEY_LENGTH).toLowerCase() + '-';
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix))
    .map((entry) => path.join(root, entry.name));
}

async function readTime(file: string, sessionId: string, signal?: AbortSignal): Promise<number | undefined> {
  signal?.throwIfAborted();
  // 只读取普通文件；未知存储布局或符号链接保留 SDK 元数据，不向任意路径扩散查找。
  if (!(await lstat(file)).isFile()) return;
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return;
    const length = Math.min(stat.size, MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, stat.size - length);
    signal?.throwIfAborted();
    return tailTime(buffer.toString('utf8', 0, bytesRead), sessionId, stat.size > length);
  } finally {
    await handle.close();
  }
}

/** SDK lastModified 是文件 mtime；元数据追加、复制或恢复文件不应冒充新的对话活动。 */
export async function claudeSessionActivity(record: SDKSessionInfo, options: ActivityOptions = {}): Promise<number> {
  options.signal?.throwIfAborted();
  if (!localRecord(record)) return record.lastModified;
  const configDir = configDirectory(options.configDir);
  try {
    const directories = await projectDirectories(path.join(configDir, 'projects'), record.cwd!);
    const times: number[] = [];
    for (const directory of directories) {
      const value = await optionalTime(
        path.join(directory, `${record.sessionId}.jsonl`),
        record.sessionId,
        options.signal,
      );
      if (value !== undefined) times.push(value);
    }
    return times.length === 1 ? times[0]! : record.lastModified;
  } catch {
    options.signal?.throwIfAborted();
    return record.lastModified;
  }
}
