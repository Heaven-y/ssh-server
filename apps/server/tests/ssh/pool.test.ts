import { once } from 'node:events';
import path from 'node:path';
import ssh2 from 'ssh2';
import type { Connection } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSshPool, type SshPool } from '../../src/ssh/pool';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function fixture() {
  // ECDSA 避开 ssh2 的 Ed25519 生成器裁剪公钥前导零问题。
  const key = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
  const peers = new Set<Connection>();
  const methods: string[] = [];
  const commands: string[] = [];
  const server = new ssh2.Server({ hostKeys: [key.private] }, (client) => {
    peers.add(client);
    client.on('error', () => undefined);
    client.on('close', () => peers.delete(client));
    client.on('authentication', (ctx) => {
      methods.push(ctx.method);
      if (ctx.method === 'password' && ctx.username === 'demo' && ctx.password === 'fixture-secret') ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (open, _reject, info) => {
          commands.push(info.command);
          const channel = open();
          channel.exit(0);
          channel.end('fixture-output\n');
        });
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture 未监听 TCP');
  const port = address.port;
  const homeDir = path.resolve('fixture-home');
  const ssh = path.join(homeDir, '.ssh');
  const files = new Map<string, Buffer>([
    [path.join(ssh, 'config'), Buffer.from(`Host my-server\n HostName 127.0.0.1\n Port ${port}\n User demo\n`)],
    [path.join(ssh, 'known_hosts'), Buffer.from(`[127.0.0.1]:${port} ${key.public}\n`)],
  ]);
  const pool: SshPool = createSshPool({
    homeDir,
    lookupHost: async (alias) => ({
      alias,
      hostname: '127.0.0.1',
      port,
      user: 'demo',
      authMode: 'password',
      identityFiles: [],
      unsupported: [],
    }),
    readFile: async (file) => {
      const value = files.get(file);
      if (!value) throw new Error('ENOENT');
      return value;
    },
  });
  cleanup.push(async () => {
    pool.dispose();
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const target = { alias: 'my-server' };
  const exec = () => pool.exec(target, 'fixture-command', { localTimeoutMs: 1000, outputCap: 1000 });
  return { pool, files, methods, commands, target, exec, knownFile: path.join(ssh, 'known_hosts'), key, port };
}

describe('SSH 密码与主机密钥真实握手', () => {
  it('仅密码认证并复用连接，断开后必须重新认证', async () => {
    const { pool, exec, methods, commands } = await fixture();
    await pool.setPassword('my-server', 'fixture-secret');
    expect(await exec()).toMatchObject({ exitCode: 0, stdout: 'fixture-output\n' });
    await exec();
    expect(methods.filter((method) => method === 'password')).toHaveLength(1);
    expect(methods).not.toContain('publickey');
    expect(commands).toEqual(['fixture-command', 'fixture-command']);
    pool.disconnect('my-server');
    await expect(exec()).rejects.toMatchObject({ code: 'connection_paused' });
  });

  it('密码错误明确报告认证失败并清除密码', async () => {
    const { pool, exec, commands } = await fixture();
    await pool.setPassword('my-server', 'wrong-secret');
    await expect(exec()).rejects.toMatchObject({ code: 'authentication_failed' });
    await expect(exec()).rejects.toMatchObject({ code: 'credentials_required' });
    expect(commands).toHaveLength(0);
  });

  it.each(['unknown', 'mismatch', 'revoked'] as const)('密码认证仍拒绝 %s 主机密钥', async (kind) => {
    const { pool, exec, files, knownFile, key, port, commands, methods } = await fixture();
    const other = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
    const text =
      kind === 'unknown'
        ? ''
        : kind === 'mismatch'
          ? `[127.0.0.1]:${port} ${other.public}\n`
          : `@revoked [127.0.0.1]:${port} ${key.public}\n`;
    files.set(knownFile, Buffer.from(text));
    await pool.setPassword('my-server', 'fixture-secret');
    await expect(exec()).rejects.toMatchObject({ code: `host_key_${kind}` });
    expect(commands).toHaveLength(0);
    expect(methods).not.toContain('password');
  });
  it('只清理匹配的认证代次，并通知活动传输取消', async () => {
    const { pool, exec } = await fixture();
    await pool.setPassword('my-server', 'fixture-secret');
    const changed = vi.fn();
    const unsubscribe = pool.onCredentialsChanged('my-server', changed);
    const generation = pool.generation('my-server');
    pool.disconnect('my-server', generation - 1);
    expect((await exec()).exitCode).toBe(0);
    expect(changed).not.toHaveBeenCalled();
    pool.disconnect('my-server', generation);
    expect(changed).toHaveBeenCalledTimes(1);
    await expect(exec()).rejects.toMatchObject({ code: 'connection_paused' });
    unsubscribe();
  });
});

it('重复连接检查只访问home并复用代次和连接，断开后状态不暴露密码', async () => {
  const { pool, methods, commands } = await fixture();
  await pool.connect({ sshHost: 'my-server', password: 'fixture-secret' });
  const generation = pool.generation('my-server');
  const changed = vi.fn();
  pool.onCredentialsChanged('my-server', changed);
  await pool.connect({ sshHost: 'my-server' });
  expect(pool.generation('my-server')).toBe(generation);
  expect(changed).not.toHaveBeenCalled();
  expect(methods.filter((method) => method === 'password')).toHaveLength(1);
  expect(commands).toHaveLength(2);
  expect(commands[0]).toContain('cd "$HOME"');
  expect(commands[0]).not.toContain('test -w');
  expect(await pool.credentialStatus('my-server')).toMatchObject({ connected: true, hasPassword: true });
  pool.disconnect('my-server');
  expect(await pool.credentialStatus('my-server')).toMatchObject({
    connected: false,
    hasPassword: false,
    paused: true,
  });
});
