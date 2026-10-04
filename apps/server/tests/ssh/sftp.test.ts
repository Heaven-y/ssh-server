import { EventEmitter } from 'node:events';
import type { Client, SFTPWrapper } from 'ssh2';
import { afterEach, expect, it, vi } from 'vitest';
import { openSftpChannel } from '../../src/ssh/sftp';

afterEach(() => vi.useRealTimers());

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
