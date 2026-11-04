import { EventEmitter } from 'node:events';
import type { ClientChannel, SFTPWrapper, Stats } from 'ssh2';
import { vi } from 'vitest';
import type { SshPool } from '../../src/ssh/pool';

export function consoleFixture() {
  let enabled = true;
  const generations = new Map<string, number>();
  let connectionVersion = 0;
  const listeners = new Map<string, Set<() => void>>();
  const shells: ReturnType<typeof shell>[] = [];
  const reads: Array<{ position: number; length: number }> = [];
  const commands: Array<{ serverId: string; command: string }> = [];
  let execOutput: (serverId: string, command: string) => string = () => '';
  let file: Buffer = Buffer.from('文件正文');
  let directoryCount = 2;
  let openBarrier: Promise<void> | undefined;
  let readBarrier: Promise<void> | undefined;
  const stat = (kind: 'file' | 'directory' | 'link', size = 0) =>
    ({
      size,
      mtime: 100,
      isFile: () => kind === 'file',
      isDirectory: () => kind === 'directory',
      isSymbolicLink: () => kind === 'link',
    }) as Stats;
  function shell() {
    const stream = () => Object.assign(new EventEmitter(), { pause: vi.fn(), resume: vi.fn() });
    const channel = Object.assign(stream(), {
      stderr: stream(),
      closed: false,
      destroyed: false,
      setWindow: vi.fn(),
      close: vi.fn(() => {
        channel.closed = true;
        channel.emit('close');
      }),
      write: vi.fn((value: string | Buffer) => {
        if (typeof value === 'string') {
          const token = /([a-f0-9]{32}):ok/.exec(value)?.[1];
          if (token) queueMicrotask(() => channel.emit('data', Buffer.from(`\x1e${token}:ok\x1f`)));
        }
        return true;
      }),
    });
    return channel;
  }
  const sftps: Array<SFTPWrapper & { end: ReturnType<typeof vi.fn> }> = [];
  function sftp() {
    let listed = false;
    const channel = Object.assign(new EventEmitter(), {
      end: vi.fn(() => channel.emit('close')),
      realpath: (value: string, done: (error: null, value: string) => void) =>
        done(null, value === '.' ? '/home/demo' : value),
      lstat: (value: string, done: (error: null, value: Stats) => void) =>
        done(null, stat(value.endsWith('text') ? 'file' : 'directory', file.length)),
      fstat: (_handle: Buffer, done: (error: null, value: Stats) => void) => done(null, stat('file', file.length)),
      open: (_path: string, flags: string, done: (error: null, value: Buffer) => void) => {
        if (flags !== 'r') throw new Error('夹具拒绝写文件');
        done(null, Buffer.from('file'));
      },
      opendir: (_path: string, done: (error: null, value: Buffer) => void) => done(null, Buffer.from('directory')),
      readdir: (_handle: Buffer, done: (error: null, value: unknown) => void) => {
        if (listed) return done(null, false);
        listed = true;
        done(
          null,
          Array.from({ length: directoryCount }, (_, index) => ({
            filename: index === 0 ? 'folder' : `text${index}`,
            longname: '',
            attrs: stat(index === 0 ? 'directory' : 'file', 10),
          })),
        );
      },
      // eslint-disable-next-line max-params -- ssh2 的原生回调签名固定为六个参数。
      read: (
        _handle: Buffer,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
        done: (error: null, count: number, buffer: Buffer) => void,
      ) => {
        reads.push({ position, length });
        const count = Math.min(length, file.length - position);
        if (count > 0) file.copy(buffer, offset, position, position + count);
        if (readBarrier) void readBarrier.then(() => done(null, Math.max(0, count), buffer));
        else done(null, Math.max(0, count), buffer);
      },
      close: (_handle: Buffer, done: (error: null) => void) => done(null),
    }) as unknown as SFTPWrapper & { end: ReturnType<typeof vi.fn> };
    sftps.push(channel);
    return channel;
  }
  const pool = {
    generation: (alias: string) => generations.get(alias) ?? 0,
    onCredentialsChanged: (alias: string, notify: () => void) => {
      const callbacks = listeners.get(alias) ?? new Set<() => void>();
      callbacks.add(notify);
      listeners.set(alias, callbacks);
      return () => callbacks.delete(notify);
    },
    resolveConnection: vi.fn(async ({ alias }: { alias: string }) => ({
      alias,
      cacheKey: `${alias}:${generations.get(alias) ?? 0}:${connectionVersion}`,
    })),
    fingerprint: vi.fn(async (alias: string) => alias),
    openSftp: vi.fn(async () => sftp()),
    openShell: vi.fn(async () => {
      const channel = shell();
      shells.push(channel);
      if (openBarrier) await openBarrier;
      return channel as unknown as ClientChannel;
    }),
    openExec: vi.fn(async ({ alias }: { alias: string }, command: string) => {
      commands.push({ serverId: alias, command });
      const channel = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn() });
      setImmediate(() => {
        channel.emit('data', Buffer.from(execOutput(alias, command)));
        channel.emit('exit', 0);
        channel.emit('close');
      });
      return channel as unknown as ClientChannel;
    }),
    disconnect: vi.fn(),
  } as unknown as SshPool;
  return {
    pool,
    shells,
    sftps,
    reads,
    commands,
    isEnabled: () => enabled,
    disable: () => {
      enabled = false;
    },
    enable: () => {
      enabled = true;
    },
    setFile: (value: Buffer) => {
      file = value;
    },
    setDirectoryCount: (value: number) => {
      directoryCount = value;
    },
    setOpenBarrier: (value: Promise<void>) => {
      openBarrier = value;
    },
    setReadBarrier: (value: Promise<void>) => {
      readBarrier = value;
    },
    setExecOutput: (value: typeof execOutput) => {
      execOutput = value;
    },
    externalIdentityChange: () => {
      connectionVersion++;
    },
    invalidate: (alias: string) => {
      generations.set(alias, (generations.get(alias) ?? 0) + 1);
      for (const notify of listeners.get(alias) ?? []) notify();
    },
  };
}
