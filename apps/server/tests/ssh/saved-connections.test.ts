import { once } from 'node:events';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import ssh2, { type Connection } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSshRoutes } from '../../src/http/ssh.routes';
import { createPasswordStore } from '../../src/ssh/password-store';
import { createSshPool } from '../../src/ssh/pool';
import { storageFailure } from '../../src/ssh/credential-storage-error';
import { createWindowsProtector, type SecretProtector } from '../../src/ssh/windows-protection';
import { createSshConfigLookup } from '../../src/ssh/connection';

const closers: Array<() => Promise<void>> = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
// 非 Windows CI 显式注入受控 AES 保护器；Windows 使用产品的真实 DPAPI。
function testProtector(): SecretProtector {
  const key = randomBytes(32);
  return {
    available: true,
    protect: (data, entropy) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(entropy);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      return Promise.resolve(Buffer.concat([nonce, cipher.getAuthTag(), encrypted]));
    },
    unprotect: (data, entropy) => {
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAAD(entropy);
      cipher.setAuthTag(data.subarray(12, 28));
      return Promise.resolve(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]));
    },
  };
}
async function fixture() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'ssh-server-saved-test-'));
  // ssh2 的 Ed25519 生成器会误裁公钥前导零，改用 ECDSA 避免随机生成畸形 fixture。
  const key = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
  const peers = new Set<Connection>();
  let acceptedPassword = 'fixture-secret';
  let directoryAvailable = true;
  let handshakes = 0;
  const delays: {
    protect?: () => Promise<void>;
    unprotect?: () => Promise<void>;
    authentication?: (password: string) => Promise<void>;
  } = {};
  const server = new ssh2.Server({ hostKeys: [key.private] }, (client) => {
    peers.add(client);
    client.on('error', () => undefined);
    client.on('close', () => peers.delete(client));
    client.on('authentication', (ctx) => {
      const finish = () => {
        if (ctx.method === 'password' && ctx.username === 'demo' && ctx.password === acceptedPassword) {
          handshakes += 1;
          ctx.accept();
        } else if (ctx.method === 'publickey') ctx.accept();
        else ctx.reject(['password', 'publickey']);
      };
      if (ctx.method === 'password' && delays.authentication) void delays.authentication(ctx.password).then(finish);
      else finish();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        accept().on('exec', (open, _reject, info) => {
          const channel = open();
          channel.exit(info.command.includes('test -d .') && !directoryAvailable ? 7 : 0);
          channel.end('fixture-output\n');
        });
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture 未监听 TCP');
  const homeDir = path.join(configDir, 'home');
  const files = new Map([
    [
      path.join(homeDir, '.ssh/config'),
      Buffer.from(`Host my-server my-alias\n HostName 127.0.0.1\n Port ${address.port}\n User demo\n`),
    ],
    [path.join(homeDir, '.ssh/known_hosts'), Buffer.from(`[127.0.0.1]:${address.port} ${key.public}\n`)],
    [path.join(homeDir, '.ssh/id_ed25519'), Buffer.from(key.private)],
  ]);
  const protector = process.platform === 'win32' ? createWindowsProtector() : testProtector();
  const store = createPasswordStore({
    configDir,
    protector: {
      available: true,
      async protect(data, entropy) {
        await delays.protect?.();
        return protector.protect(data, entropy);
      },
      async unprotect(data, entropy) {
        await delays.unprotect?.();
        return protector.unprotect(data, entropy);
      },
    },
  });
  const pools: ReturnType<typeof createSshPool>[] = [];
  const apps: FastifyInstance[] = [];
  const authentication: { authMode: 'key' | 'password' } = { authMode: 'password' };
  const readConfig = async (file: string) => {
    const data = files.get(file);
    if (!data) throw new Error('ENOENT');
    return data;
  };
  const restart = () => {
    const pool = createSshPool({
      homeDir,
      passwordStore: store,
      lookupHost: (alias) =>
        createSshConfigLookup({ homeDir, readFile: readConfig, authMode: authentication.authMode })(alias),
      readFile: (file) => {
        const data = files.get(file);
        return data ? Promise.resolve(data) : Promise.reject(new Error('ENOENT'));
      },
    });
    pools.push(pool);
    const app = Fastify();
    registerSshRoutes(app, { pool, profiles: { connection: async (_alias, _changing, operation) => operation() } });
    apps.push(app);
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    const status = async () => (await app.inject({ url: '/api/ssh/credentials?sshHost=my-server' })).json<unknown>();
    const clear = () =>
      app.inject({
        method: 'PUT',
        url: '/api/ssh/credentials',
        payload: { sshHost: 'my-server', savePassword: false },
      });
    return { pool, post, status, clear, app };
  };
  closers.push(async () => {
    pools.forEach((pool) => pool.dispose());
    await Promise.all(apps.map((app) => app.close()));
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(configDir, { recursive: true, force: true });
  });
  return {
    configDir,
    restart,
    files,
    homeDir,
    delays,
    store,
    authentication,
    handshakes: () => handshakes,
    rotatePassword: () => {
      acceptedPassword = 'changed-secret';
    },
    disableDirectory: () => {
      directoryAvailable = false;
    },
  };
}
const input = { sshHost: 'my-server' };
const supplied = { ...input, password: 'fixture-secret', savePassword: true };
const target = { alias: 'my-server' };

describe('保存密码的实际 SSH 与网页接口链路', () => {
  it('验证成功后写密文，断开暂停自动连接，显式重连和新后端实例复用', async () => {
    const f = await fixture();
    const first = f.restart();
    const response = await first.post('/api/ssh/connect', supplied);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ connected: true, saved: true, savingAvailable: true, paused: false });
    const names = await readdir(path.join(f.configDir, 'credentials'));
    expect(names).toHaveLength(1);
    expect(await readFile(path.join(f.configDir, 'credentials', names[0]!), 'utf8')).not.toContain('fixture-secret');
    expect((await first.post('/api/ssh/disconnect', { sshHost: 'my-server' })).statusCode).toBe(204);
    expect(await first.status()).toMatchObject({ saved: true, paused: true });
    await expect(first.pool.resolveConnection(target)).rejects.toMatchObject({ code: 'connection_paused' });
    await expect(
      first.pool.exec(target, 'fixture-command', { localTimeoutMs: 1000, outputCap: 1000 }),
    ).rejects.toMatchObject({ code: 'connection_paused' });
    expect(f.handshakes()).toBe(1);
    expect((await first.post('/api/ssh/connect', input)).statusCode).toBe(200);
    expect(f.handshakes()).toBe(2);
    first.pool.dispose();
    expect((await f.restart().post('/api/ssh/connect', input)).statusCode).toBe(200);
    expect(f.handshakes()).toBe(3);
  }, 20_000);

  it('取消保存失败时仍可重试，成功删除后暂停连接且不再复用密码', async () => {
    const { restart, store } = await fixture();
    const f = restart();
    expect((await f.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
    vi.spyOn(store, 'forget').mockRejectedValueOnce(storageFailure());
    expect((await f.clear()).json()).toMatchObject({ code: 'credential_storage_failed' });
    expect(await f.status()).toMatchObject({ saved: true, paused: true });
    expect((await f.clear()).json()).toMatchObject({ saved: false, paused: true });
    expect(await f.status()).toMatchObject({ saved: false, paused: true });
    const response = await f.post('/api/ssh/connect', input);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'credentials_required' });
  }, 20_000);

  it('显式不保存只在连接验证成功后删除旧保存项，省略选项保留保存状态', async () => {
    const f = await fixture();
    const connection = f.restart();
    expect((await connection.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
    expect((await connection.post('/api/ssh/connect', input)).json()).toMatchObject({ saved: true });
    expect(
      (await connection.post('/api/ssh/connect', { ...input, authMode: 'key', savePassword: false })).statusCode,
    ).toBe(400);
    expect(await connection.status()).toMatchObject({ saved: true });
    expect((await connection.post('/api/ssh/connect', { ...input, savePassword: false })).json()).toMatchObject({
      saved: false,
      connected: true,
    });
    connection.pool.dispose();
    expect((await f.restart().post('/api/ssh/connect', input)).json()).toMatchObject({ code: 'credentials_required' });
  }, 20_000);

  it.each(['disconnect', 'dispose'] as const)(
    '解密中 %s 后迟到的读取不会恢复认证',
    async (action) => {
      const f = await fixture();
      const first = f.restart();
      expect((await first.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
      first.pool.dispose();
      const next = f.restart();
      const entered = deferred();
      const gate = deferred();
      f.delays.unprotect = () => {
        entered.resolve();
        return gate.promise;
      };
      const pending = next.pool.resolveConnection(target);
      const rejected = expect(pending).rejects.toMatchObject({ code: 'connection_cancelled' });
      await entered.promise;
      if (action === 'disconnect') next.pool.disconnect('my-server');
      else next.pool.dispose();
      gate.resolve();
      await rejected;
      expect(f.handshakes()).toBe(1);
      expect(await next.status()).toMatchObject({ saved: true });
    },
    20_000,
  );

  it('加密保存中取消保存，旧请求不能重写磁盘或恢复已暂停连接', async () => {
    const f = await fixture();
    const next = f.restart();
    const entered = deferred();
    const gate = deferred();
    f.delays.protect = () => {
      entered.resolve();
      return gate.promise;
    };
    const pending = next.post('/api/ssh/connect', supplied).then((response) => response);
    await entered.promise;
    const clearing = next.clear().then((response) => response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    gate.resolve();
    expect((await pending).statusCode).toBe(409);
    expect((await clearing).json()).toMatchObject({ saved: false, paused: true });
    expect(await next.status()).toMatchObject({ saved: false, paused: true });
  }, 20_000);

  it('目录错误保留保存项，未通过目录验证的新密码不会保存', async () => {
    const f = await fixture();
    const connection = f.restart();
    f.disableDirectory();
    expect((await connection.post('/api/ssh/connect', supplied)).statusCode).toBe(502);
    expect(await connection.status()).toMatchObject({ saved: false });
    // 临时恢复目录响应，用另一 fixture 验证已有保存项的保留。
    const valid = await fixture();
    const existing = valid.restart();
    expect((await existing.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
    valid.disableDirectory();
    expect((await existing.post('/api/ssh/connect', { ...input, savePassword: false })).statusCode).toBe(502);
    expect(await existing.status()).toMatchObject({ saved: true });
  }, 20_000);

  it('保存密码实际认证失败时失效，不再从磁盘重新加载', async () => {
    const f = await fixture();
    const first = f.restart();
    expect((await first.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
    first.pool.dispose();
    f.rotatePassword();
    const next = f.restart();
    await next.pool.resolveConnection({ alias: 'my-alias' });
    const response = await next.post('/api/ssh/connect', input);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'authentication_failed' });
    expect(await next.status()).toMatchObject({ saved: false });
    expect((await next.post('/api/ssh/connect', input)).json()).toMatchObject({ code: 'credentials_required' });
    await expect(next.pool.resolveConnection({ alias: 'my-alias' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
  }, 20_000);

  it('加密过程中目标账号改变，不提交旧目标的迟到保存', async () => {
    const f = await fixture();
    const connection = f.restart();
    const entered = deferred();
    const gate = deferred();
    f.delays.protect = () => {
      entered.resolve();
      return gate.promise;
    };
    const pending = connection.post('/api/ssh/connect', supplied).then((response) => response);
    await entered.promise;
    const configPath = path.join(f.homeDir, '.ssh/config');
    f.files.set(configPath, Buffer.from(f.files.get(configPath)!.toString('utf8').replace('User demo', 'User other')));
    gate.resolve();
    expect((await pending).statusCode).toBe(409);
    expect(await readdir(path.join(f.configDir, 'credentials'))).toEqual([]);
  }, 20_000);

  it('同目标另一别名的旧握手迟到失败，不能删除新验证成功的密码', async () => {
    const f = await fixture();
    const connection = f.restart();
    expect((await connection.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
    const entered = deferred();
    const gate = deferred();
    f.delays.authentication = (password) => {
      if (password !== 'fixture-secret') return Promise.resolve();
      entered.resolve();
      return gate.promise;
    };
    const pending = connection
      .post('/api/ssh/connect', { ...input, sshHost: 'my-alias', savePassword: true })
      .then((response) => response);
    await entered.promise;
    f.rotatePassword();
    expect(
      (await connection.post('/api/ssh/connect', { ...supplied, password: 'changed-secret' })).json(),
    ).toMatchObject({ connected: true, saved: true });
    gate.resolve();
    expect((await pending).statusCode).toBe(409);
    expect(await connection.status()).toMatchObject({ saved: true });
    connection.pool.disconnect('my-server');
    expect((await connection.post('/api/ssh/connect', input)).json()).toMatchObject({ connected: true, saved: true });
  }, 20_000);

  it('网页提前关闭响应撤销旧保存，不影响后续同 Host 显式连接', async () => {
    const f = await fixture();
    const connection = f.restart();
    const entered = deferred();
    const gate = deferred();
    f.delays.protect = () => {
      entered.resolve();
      return gate.promise;
    };
    const abort = new AbortController();
    const closed = deferred();
    connection.app.addHook('onRequest', (_req, reply, done) => {
      reply.raw.once('close', closed.resolve);
      done();
    });
    const origin = await connection.app.listen({ host: '127.0.0.1', port: 0 });
    const pending = fetch(`${origin}/api/ssh/connect`, {
      method: 'POST',
      body: JSON.stringify(supplied),
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
    }).then(
      () => undefined,
      () => undefined,
    );
    await entered.promise;
    abort.abort();
    await pending;
    await closed.promise;
    await expect(connection.pool.resolveConnection(target)).rejects.toMatchObject({ code: 'connection_paused' });
    f.authentication.authMode = 'key';
    const next = connection.post('/api/ssh/connect', input).then((response) => response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    gate.resolve();
    expect((await next).json()).toMatchObject({ connected: true, authMode: 'key', saved: false, paused: false });
    expect(await connection.status()).toMatchObject({ saved: false, paused: false });
  }, 20_000);

  it('Host 改到其他账号不能加载原目标保存密码', async () => {
    const f = await fixture();
    const first = f.restart();
    expect((await first.post('/api/ssh/connect', supplied)).statusCode).toBe(200);
    first.pool.dispose();
    const configPath = path.join(f.homeDir, '.ssh/config');
    f.files.set(configPath, Buffer.from(f.files.get(configPath)!.toString('utf8').replace('User demo', 'User other')));
    const next = f.restart();
    expect(await next.status()).toMatchObject({ saved: false });
    expect((await next.post('/api/ssh/connect', input)).json()).toMatchObject({ code: 'credentials_required' });
  }, 20_000);
});
