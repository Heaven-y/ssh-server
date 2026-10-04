import path from 'node:path';
import type { RemoteFileEntry, SyncSettings } from '@ssh-server/shared';
import type { FileEntryWithStats, Stats } from 'ssh2';
import { eligibleFile, excludedPath, safeRelativePath } from '../sync/filters';
import { RemoteFilesError } from './errors';

export function remotePath(input: string, root: string, home: string): string {
  if (
    input.length > 4096 ||
    input.includes('\0') ||
    (input.startsWith('~') && input !== '~' && !input.startsWith('~/'))
  )
    throw new RemoteFilesError('invalid_path');
  if (input === '~' || input.startsWith('~/')) return path.posix.resolve(home, input.slice(2));
  return path.posix.resolve(root, input || '.');
}

export function inside(root: string, target: string): boolean {
  const relative = path.posix.relative(root, target);
  return relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative);
}

function scopeOf(
  entry: Omit<RemoteFileEntry, 'scope'>,
  root: string,
  settings: SyncSettings,
): RemoteFileEntry['scope'] {
  if (!inside(root, entry.path)) return 'outside';
  if (entry.type === 'link') return 'link';
  const relative = path.posix.relative(root, entry.path);
  if (relative) {
    try {
      safeRelativePath(relative);
    } catch {
      return 'unsupported';
    }
    if (excludedPath(relative, settings)) return 'excluded';
  }
  if (entry.type === 'directory') return 'directory';
  if (entry.type !== 'file' || entry.size === undefined) return 'unsupported';
  return eligibleFile(relative, entry.size, settings) ? 'included' : 'excluded';
}

function entryType(stat: Stats): RemoteFileEntry['type'] {
  if (stat.isSymbolicLink()) return 'link';
  if (stat.isDirectory()) return 'directory';
  return stat.isFile() ? 'file' : 'other';
}

export function directoryEntry(
  item: FileEntryWithStats,
  directory: string,
  root: string,
  settings: SyncSettings,
): RemoteFileEntry | undefined {
  const name = item.filename;
  if (!name || name === '.' || name === '..' || /[\0/]/.test(name)) return undefined;
  const type = entryType(item.attrs);
  const size =
    type === 'file' && Number.isSafeInteger(item.attrs.size) && item.attrs.size >= 0 ? item.attrs.size : undefined;
  const modifiedAt = Number.isFinite(item.attrs.mtime) && item.attrs.mtime >= 0 ? item.attrs.mtime * 1000 : undefined;
  const entry: Omit<RemoteFileEntry, 'scope'> = {
    name,
    path: path.posix.join(directory, name),
    type,
    size,
    modifiedAt,
  };
  return { ...entry, scope: scopeOf(entry, root, settings) };
}
