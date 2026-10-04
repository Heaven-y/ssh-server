import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ssh2, { type Client } from 'ssh2';
import { expect, it, vi } from 'vitest';
import { startTerminalFixture } from '../../../../scripts/dev/terminal-fixture';
import { createSftpReader } from '../../src/ssh/sftp';

it('guarded SFTP回调同一调用栈报错只结束该通道，共享SSH仍可执行', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terminal-sftp-'));
  const f = await startTerminalFixture({
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(root, 'workspace'),
  });
  const original = ssh2.Client.prototype.sftp;
  const spy = vi.spyOn(ssh2.Client.prototype, 'sftp').mockImplementation(function (this: Client, done) {
    return original.call(this, (error, channel) => {
      done(error, channel);
      if (channel) channel.emit('error', new Error('fixture-invalid-packet'));
    });
  });
  try {
    const target = { alias: 'my-server', authMode: 'password' as const };
    const connection = await f.pool.resolveConnection(target);
    const channel = await f.pool.openSftp(target, {
      generation: f.pool.generation('my-server'),
      cacheKey: connection.cacheKey,
      signal: new AbortController().signal,
    });
    const reader = createSftpReader(channel);
    await expect(reader.realpath('.')).rejects.toMatchObject({ code: 'sftp_closed' });
    reader.close();
    expect((await f.pool.exec(target, 'pwd', { localTimeoutMs: 1000, outputCap: 1000 })).exitCode).toBe(0);
  } finally {
    spy.mockRestore();
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
