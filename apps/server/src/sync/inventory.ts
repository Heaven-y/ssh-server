// 本地文件清单：不跟随符号链接，固定跳过 .git，不读取大文件内容。
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SyncSettings } from '@ssh-server/shared';
import { SyncError } from './errors';
import { eligibleFile, safeRelativePath } from './filters';

export type FileEntry = { path: string; size: number; modTime: string };
export const hash = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');
export function workspaceStateDir(configDir: string, id: string): string {
  return path.join(configDir, 'sync', hash(id));
}
export async function localInventory(
  root: string,
  settings: SyncSettings,
): Promise<{ all: FileEntry[]; included: FileEntry[]; directories: string[] }> {
  const all: FileEntry[] = [];
  const directories: string[] = [];
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new SyncError('unsafe_path', '本地同步根目录必须是普通目录');
  async function visit(relative: string): Promise<void> {
    for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (item.name.toLowerCase() === '.git') continue;
      const file = relative ? `${relative}/${item.name}` : item.name;
      safeRelativePath(file);
      const stat = await lstat(path.join(root, file));
      if (stat.isSymbolicLink()) throw new SyncError('unsafe_path', '同步目录含符号链接，请移除链接后重试');
      if (stat.isDirectory()) {
        directories.push(file);
        await visit(file);
      } else if (stat.isFile()) all.push({ path: file, size: stat.size, modTime: stat.mtime.toISOString() });
    }
  }
  await visit('');
  return { all, included: all.filter((file) => eligibleFile(file.path, file.size, settings)), directories };
}
export async function safeLocalFile(root: string, relative: string): Promise<string> {
  safeRelativePath(relative);
  const parts = relative.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new SyncError('unsafe_path', '同步路径经过符号链接或非目录，已停止');
  }
  const target = path.join(root, ...parts);
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new SyncError('unsafe_path', '同步目标不是普通文件，已停止');
  return target;
}
export async function localHash(root: string, file: FileEntry, settings: SyncSettings): Promise<string> {
  if (!eligibleFile(file.path, file.size, settings))
    throw new SyncError('filter_changed', '文件已超出同步范围，需重新确认初始化');
  const target = await safeLocalFile(root, file.path);
  const data = await readFile(target);
  if (data.length > settings.maxFileBytes) throw new SyncError('filter_changed', '文件读取期间超过同步上限，已停止');
  return hash(data);
}
