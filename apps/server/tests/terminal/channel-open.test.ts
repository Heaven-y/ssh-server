import { EventEmitter } from 'node:events';
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import { afterEach, expect, it, vi } from 'vitest';
import { openGuardedSshChannel } from '../../src/ssh/channel-open';
import { initializeTerminal } from '../../src/terminal/initialization';
import { createSftpReader, openSftpChannel } from '../../src/ssh/sftp';
import { resolveTerminalDirectory } from '../../src/terminal/directory';

afterEach(() => vi.useRealTimers());
it('取消先于回调时立即拒绝且回收迟到通道', async () => {
  const controller = new AbortController();
  let done!: (error: Error | undefined, channel: object) => void;
  const release = vi.fn();
  const pending = openGuardedSshChannel<object>(
    (callback) => {
      done = callback;
    },
    { signal: controller.signal, current: () => true, release },
  ).catch((e: unknown) => e);
  controller.abort();
  expect(await pending).toBeInstanceOf(Error);
  const late = {};
  done(undefined, late);
  expect(release).toHaveBeenCalledWith(late);
});
it('初始化忽略回显文本，逐字节确认后保留原始中文尾部', async () => {
  let command = '';
  const channel = Object.assign(new EventEmitter(), {
    stderr: Object.assign(new EventEmitter(), { pause: vi.fn() }),
    pause: vi.fn(),
    close: vi.fn(),
    write: vi.fn((value: string) => {
      command = value;
      return true;
    }),
  });
  const pending = initializeTerminal({
    channel: channel as unknown as ClientChannel,
    startDir: "/home/demo/project's space",
    signal: new AbortController().signal,
  });
  const token = command.match(/([a-f0-9]{32}):ok/)![1];
  expect(command).toContain("'\\''");
  channel.emit('data', Buffer.from(command));
  const frame = Buffer.from(`\x1e${token}:ok\x1f`);
  for (const byte of frame.subarray(0, -1)) channel.emit('data', Buffer.from([byte]));
  channel.emit('data', Buffer.concat([frame.subarray(-1), Buffer.from('中文\xff')]));
  expect(Buffer.concat((await pending).trailing)).toEqual(Buffer.from('中文\xff'));
  expect(channel.pause).toHaveBeenCalledOnce();
  expect(channel.stderr.pause).toHaveBeenCalledOnce();
});
it('初始化超限与超时关闭PTY，不开放输入', async () => {
  vi.useFakeTimers();
  const make = () => Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn(), write: vi.fn() });
  const first = make();
  const over = initializeTerminal({
    channel: first as unknown as ClientChannel,
    startDir: '/demo',
    signal: new AbortController().signal,
  }).catch((e: unknown) => e);
  first.stderr.emit('data', Buffer.alloc(131073));
  expect(await over).toMatchObject({ code: 'startup_failed' });
  const second = make();
  const slow = initializeTerminal({
    channel: second as unknown as ClientChannel,
    startDir: '/demo',
    signal: new AbortController().signal,
  }).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await slow).toMatchObject({ code: 'startup_failed' });
  expect(second.close).toHaveBeenCalledOnce();
});
it('回调到reader移交间SFTP错误不抛向共享SSH，reader立即拒绝', async () => {
  const channel = Object.assign(new EventEmitter(), { end: vi.fn(), realpath: vi.fn() });
  const pending = openSftpChannel({
    sftp: (callback) => {
      callback(undefined, channel as unknown as SFTPWrapper);
      channel.emit('error', new Error('invalid packet'));
      return {} as Client;
    },
  });
  const reader = createSftpReader(await pending);
  const result = reader.realpath('.').catch((e: unknown) => e);
  // 应立即终止，不应等15秒，更不能继续发出请求。
  expect(channel.realpath).not.toHaveBeenCalled();
  reader.close();
  expect(await result).toMatchObject({ code: 'sftp_closed' });
});
it('打开回调时身份变化回收通道，同步异常立即拒绝', async () => {
  const release = vi.fn();
  const signal = new AbortController().signal;
  const channel = {};
  await expect(
    openGuardedSshChannel((done) => done(undefined, channel), { signal, current: () => false, release }),
  ).rejects.toThrow('身份已变化');
  expect(release).toHaveBeenCalledWith(channel);
  await expect(
    openGuardedSshChannel(
      () => {
        throw new Error('failed');
      },
      { signal, current: () => true, release },
    ),
  ).rejects.toThrow('failed');
});
it('不是目录时释放SFTP并拒绝创建PTY，初始化失败帧和取消均关闭通道', async () => {
  const sftp = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    realpath: (_path: string, done: (error: undefined, value: string) => void) => done(undefined, '/missing'),
    lstat: (_path: string, done: (error: undefined, value: object) => void) =>
      done(undefined, { isDirectory: () => false }),
  });
  await expect(
    resolveTerminalDirectory({
      workspace: { id: 'w', name: '工作区', localDir: 'fixture', sshHost: 'my-server', remoteDir: '~/missing' },
      pool: { openSftp: async () => sftp as unknown as SFTPWrapper },
      guard: { generation: 0, cacheKey: 'key', signal: new AbortController().signal },
    }),
  ).rejects.toMatchObject({ code: 'directory_unavailable' });
  expect(sftp.end).toHaveBeenCalledOnce();
  const controller = new AbortController();
  let command = '';
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    close: vi.fn(),
    write: (text: string) => {
      command = text;
      return true;
    },
  });
  const failed = initializeTerminal({
    channel: channel as unknown as ClientChannel,
    startDir: '/missing',
    signal: controller.signal,
  }).catch((error: unknown) => error);
  const token = command.match(/([a-f0-9]{32}):fail/)![1];
  channel.emit('data', Buffer.from(`\x1e${token}:fail\x1f`));
  expect(await failed).toMatchObject({ code: 'directory_unavailable' });
  const aborted = initializeTerminal({
    channel: channel as unknown as ClientChannel,
    startDir: '/missing',
    signal: controller.signal,
  }).catch((error: unknown) => error);
  controller.abort();
  expect(await aborted).toMatchObject({ code: 'cancelled' });
});
