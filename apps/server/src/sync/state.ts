// 本机同步状态，原子替换；只允许当前布局的中断恢复，旧格式和损坏文件绝不改写。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SyncConflict, SyncSettings, SyncStatus } from '@ssh-server/shared';
import { safeRelativePath } from './filters';
import { hash, workspaceStateDir, type FileEntry } from './inventory';
import { SyncError } from './errors';

const RelativePath = z.string().refine((file) => {
  try {
    safeRelativePath(file);
    return true;
  } catch {
    return false;
  }
});
const ConflictSchema = z.object({ path: RelativePath, localCopy: RelativePath, remoteCopy: RelativePath });
const StateSchema = z.object({
  version: z.literal(1),
  signature: z.string().optional(),
  baselineLayout: z.string().min(1).max(64).optional(),
  remoteTask: z.string().uuid().optional(),
  configuration: z.string().optional(),
  filters: z.string(),
  baseline: z.array(z.object({ path: RelativePath, size: z.number().nonnegative(), modTime: z.string() })),
  phase: z.enum(['uninitialized', 'syncing', 'ready', 'confirmation_required', 'conflicts', 'error']),
  reason: z.enum(['initialization', 'deletions', 'recovery', 'filter_changed']).optional(),
  message: z.string().optional(),
  lastSuccessAt: z.number().optional(),
  deletions: z.array(RelativePath),
  conflicts: z.array(ConflictSchema),
  deletionHashes: z.record(RelativePath, z.string().nullable()),
});
export type SyncState = z.infer<typeof StateSchema>;
export const emptyState = (): SyncState => ({
  version: 1,
  filters: '',
  baseline: [],
  phase: 'uninitialized',
  deletions: [],
  conflicts: [],
  deletionHashes: {},
});
export const settingsDigest = (settings: SyncSettings): string => hash(JSON.stringify(settings));
export function publicStatus(state: SyncState, settings: SyncSettings): SyncStatus {
  const { phase, reason, message, lastSuccessAt, deletions, conflicts } = state;
  return {
    phase: state.remoteTask ? 'confirmation_required' : phase,
    reason: state.remoteTask ? 'recovery' : reason,
    message: state.remoteTask ? '服务器文件任务尚未完成同步协调，请在文件任务中核对或恢复；普通同步已暂停。' : message,
    lastSuccessAt,
    deletions: [...deletions],
    conflicts: conflicts.map((item) => ({ ...item })),
    settings,
  };
}
export async function loadSyncState(configDir: string, id: string): Promise<SyncState> {
  try {
    const text = await readFile(path.join(workspaceStateDir(configDir, id), 'state.json'), 'utf8');
    if (text.length > 4 * 1024 * 1024) throw new Error('too large');
    const state = StateSchema.parse(JSON.parse(text));
    if (
      (state.baseline.length > 0 && !state.signature) ||
      (state.signature !== undefined && state.baselineLayout !== 'combine-v1')
    )
      throw new SyncError(
        'state_unsupported',
        '本地同步基线格式不受支持，已保留原文件；请使用匹配版本处理，不能通过确认升级',
      );
    if (state.phase === 'syncing')
      Object.assign(state, {
        phase: 'confirmation_required',
        reason: 'recovery',
        message: '上次同步未完成，请确认恢复并保留双端版本',
      });
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    if (error instanceof SyncError) throw error;
    throw new SyncError(
      'state_storage_error',
      '本地同步状态损坏或不可读，已停止同步并保留原文件；请检查配置目录权限或恢复有效配置',
    );
  }
}
export async function saveSyncState(configDir: string, id: string, state: SyncState): Promise<void> {
  const dir = workspaceStateDir(configDir, id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}
export function newConflicts(files: FileEntry[], baseline: FileEntry[]): SyncConflict[] {
  const previous = new Set(baseline.map((file) => file.path));
  const grouped = new Map<string, Partial<SyncConflict>>();
  for (const file of files) {
    if (previous.has(file.path)) continue;
    const match = /^(.*)\.ssh-(local|remote)-conflict\d+$/.exec(file.path);
    if (!match) continue;
    const original = match[1]!;
    const item = grouped.get(original) ?? { path: original };
    if (match[2] === 'local') item.localCopy = file.path;
    else item.remoteCopy = file.path;
    grouped.set(original, item);
  }
  return [...grouped.values()].filter(
    (item): item is SyncConflict => !!item.path && !!item.localCopy && !!item.remoteCopy,
  );
}
