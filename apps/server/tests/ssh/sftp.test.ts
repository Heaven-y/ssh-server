import { EventEmitter } from 'node:events';
import type { Client, SFTPWrapper } from 'ssh2';
import { afterEach, expect, it, vi } from 'vitest';
import { createSftpReader, openSftpChannel } from '../../src/ssh/sftp';

afterEach(() => vi.useRealTimers());

it('SFTP 断线后立即拒绝新请求，不再调用通道，也不重复关闭资源', async () => {
  const channel = Object.assign(new EventEmitter(), { end: vi.fn(), lstat: vi.fn() });
  const reader = createSftpReader(channel as unknown as SFTPWrapper);
  channel.emit('end');
  await expect(reader.lstat('missing.py')).rejects.toMatchObject({ code: 'sftp_closed' });
  reader.close();
  expect(channel.lstat).not.toHaveBeenCalled();
  expect(channel.end).toHaveBeenCalledOnce();
});

it('SFTP 打开超时后仍关闭迟到通道', async () => {
  vi.useFakeTimers();
  let complete!: Parameters<Client['sftp']>[0];
  const client = {
    sftp: vi.fn((done: typeof complete) => {
      complete = done;
    }),
  } as unknown as Pick<Client, 'sftp'>;
  const result = openSftpChannel(client).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await result).toMatchObject({ code: 'sftp_timeout' });
  const channel = Object.assign(new EventEmitter(), { end: vi.fn() });
  complete(undefined, channel as unknown as SFTPWrapper);
  expect(channel.end).toHaveBeenCalledOnce();
});
