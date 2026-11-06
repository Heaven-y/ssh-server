import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';
import { SSH_CONSOLE_LIMITS, SshConsolePathSchema, type SshConsoleFileEntry } from '@agentdeck/shared/ssh';
import type { SshPool } from '../ssh/pool';
import { createSftpReader, type SftpReader } from '../ssh/sftp';
import { remotePath } from '../legacy/remote-files/paths';
import type { ConsoleAccess, ConsoleLease } from './access';
import { SshConsoleError } from './errors';

function fileType(attrs: Stats): SshConsoleFileEntry['type'] {
  if (attrs.isSymbolicLink()) return 'link';
  if (attrs.isDirectory()) return 'directory';
  return attrs.isFile() ? 'file' : 'other';
}
function entry(item: FileEntryWithStats, directory: string): SshConsoleFileEntry | undefined {
  if (!item.filename || /[\0/]/.test(item.filename) || ['.', '..'].includes(item.filename)) return;
  const attrs = item.attrs;
  return {
    name: item.filename,
    path: path.posix.join(directory, item.filename),
    type: fileType(attrs),
    size: Number.isSafeInteger(attrs.size) && attrs.size >= 0 ? attrs.size : null,
    modifiedAt: Number.isFinite(attrs.mtime) && attrs.mtime >= 0 ? attrs.mtime * 1000 : null,
  };
}
function sftpCall<T>(signal: AbortSignal, action: (done: (error: Error | null | undefined, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new SshConsoleError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    const done = (error: Error | null | undefined, value: T) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
      else if (error) reject(error);
      else resolve(value);
    };
    if (signal.aborted) done(new SshConsoleError('cancelled'), undefined as T);
    else {
      try {
        action(done);
      } catch (error) {
        done(error as Error, undefined as T);
      }
    }
  });
}

export async function consoleDirectory(reader: SftpReader, directory: string): Promise<string> {
  if (!SshConsolePathSchema.safeParse(directory).success) throw new SshConsoleError('invalid_request');
  const home = await reader.realpath('.');
  const resolved = await reader.realpath(remotePath(directory, home, home));
  if (!resolved.startsWith('/') || !SshConsolePathSchema.safeParse(resolved).success)
    throw new SshConsoleError('directory_unavailable');
  return resolved;
}
type FileContext = { reader: SftpReader; channel: SFTPWrapper; lease: ConsoleLease };

export function createConsoleFiles(pool: SshPool, access: ConsoleAccess) {
  async function use<T>(serverId: string, action: (context: FileContext) => Promise<T>, signal?: AbortSignal) {
    const limited = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30_000)]);
    const lease = await access.capture(serverId, limited);
    let reader: SftpReader | undefined;
    const cancel = () => reader?.close(new SshConsoleError('cancelled'));
    lease.signal.addEventListener('abort', cancel, { once: true });
    try {
      const channel = await pool.openSftp(lease.target, lease.guard);
      reader = createSftpReader(channel);
      lease.check();
      const result = await action({ reader, channel, lease });
      await lease.recheck();
      return result;
    } finally {
      lease.signal.removeEventListener('abort', cancel);
      reader?.close();
      lease.close();
    }
  }
  return {
    async listDirectory(serverId: string, directory = '~', signal?: AbortSignal) {
      return use(
        serverId,
        async ({ reader, lease }) => {
          const resolved = await consoleDirectory(reader, directory);
          const handle = await reader.opendir(resolved);
          const entries: SshConsoleFileEntry[] = [];
          try {
            while (entries.length <= SSH_CONSOLE_LIMITS.directoryEntries) {
              lease.check();
              const items = await reader.readdir(handle);
              if (!items) break;
              for (const item of items) {
                const value = entry(item, resolved);
                if (value) entries.push(value);
                if (entries.length > SSH_CONSOLE_LIMITS.directoryEntries) break;
              }
            }
          } finally {
            await reader.closeHandle(handle).catch(() => undefined);
          }
          const truncated = entries.length > SSH_CONSOLE_LIMITS.directoryEntries;
          const selected = entries.slice(0, SSH_CONSOLE_LIMITS.directoryEntries);
          selected.sort(
            (a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name),
          );
          return { serverId, path: resolved, parentPath: path.posix.dirname(resolved), entries: selected, truncated };
        },
        signal,
      );
    },
    async preview(serverId: string, file: string, signal?: AbortSignal) {
      return use(
        serverId,
        async ({ reader, channel, lease }) => {
          const transferSignal = AbortSignal.any([lease.signal, reader.signal]);
          const resolved = await consoleDirectory(reader, file);
          if (!(await reader.lstat(resolved)).isFile()) throw new SshConsoleError('file_unavailable');
          const handle = await sftpCall<Buffer>(transferSignal, (done) => channel.open(resolved, 'r', done));
          try {
            const attrs = await reader.fstat(handle);
            if (!attrs.isFile() || !Number.isSafeInteger(attrs.size) || attrs.size < 0)
              throw new SshConsoleError('file_unavailable');
            const bytes = await readHead(channel, handle, transferSignal);
            const binary = bytes.includes(0);
            const truncated = attrs.size > bytes.length;
            const decoder = new StringDecoder('utf8');
            const text = decoder.write(bytes) + (truncated ? '' : decoder.end());
            return { serverId, path: resolved, size: attrs.size, text: binary ? '' : text, binary, truncated };
          } finally {
            await reader.closeHandle(handle).catch(() => undefined);
          }
        },
        signal,
      );
    },
  };
}

async function readHead(channel: SFTPWrapper, handle: Buffer, signal: AbortSignal) {
  const buffer = Buffer.alloc(SSH_CONSOLE_LIMITS.previewBytes);
  let length = 0;
  while (length < buffer.length) {
    const count = await sftpCall<number>(signal, (done) =>
      channel.read(handle, buffer, length, Math.min(32768, buffer.length - length), length, (error, count) =>
        done(error, count),
      ),
    );
    if (!count) break;
    length += count;
  }
  return buffer.subarray(0, length);
}
