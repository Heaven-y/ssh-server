import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedServer } from '@ssh-server/shared';
import { connectionIdentity } from '../../src/ssh/connection';
import { credentialEditorFixture, deferred, input } from './credential-editor.fixture';

// 任何误触认证都会失败，且不会向外部服务器发包。
vi.mock('../../src/ssh/client', () => ({
  connectSshClient: () => {
    throw new Error('编辑不得发起 SSH');
  },
}));
const fixtures: Awaited<ReturnType<typeof credentialEditorFixture>>[] = [];
async function fixture() {
  const f = await credentialEditorFixture();
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.close()));
});
type PasswordRead = { password: string | null; revision: string; savingAvailable: boolean };
async function revision(f: Awaited<ReturnType<typeof fixture>>, server = f.server) {
  const response = await f.read(server);
  expect(response.statusCode).toBe(200);
  return response.json<PasswordRead>().revision;
}

describe('明确编辑服务器才按需读取和保存密码', () => {
  it('列表与状态不解密或回传密码，明确读取返回实际字段且禁止缓存', async () => {
    const f = await fixture();
    await f.passwords.save(connectionIdentity(f.server), 'fixture-existing-secret');
    const decrypt = vi.spyOn(f.protector, 'unprotect');
    for (const url of ['/api/ssh-targets', `/api/ssh/credentials?sshHost=${f.server.alias}`]) {
      const ordinary = await f.app.inject({ url, headers: f.headers });
      expect(ordinary.statusCode).toBe(200);
      expect(ordinary.body).not.toContain('fixture-existing-secret');
      expect(ordinary.json()).not.toHaveProperty('password');
    }
    expect(decrypt).not.toHaveBeenCalled();
    const response = await f.read();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      password: 'fixture-existing-secret',
      revision: expect.any(String),
      savingAvailable: true,
    });
    expect(await f.pool.credentialStatus(f.server.alias)).toMatchObject({ connected: false, hasPassword: false });
  });

  it('确认保存同时更新档案与密文，不认证；旧身份代次和编辑revision均失效', async () => {
    const f = await fixture();
    await f.passwords.save(connectionIdentity(f.server), 'fixture-existing-secret');
    await f.pool.setPassword(f.server.alias, 'fixture-temporary-secret');
    const before = f.pool.generation(f.server.alias);
    const oldRevision = await revision(f);
    const response = await f.edit(oldRevision, {
      input: { ...input, name: '已修改名称' },
      password: 'fixture-replacement-secret',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ name: '已修改名称', alias: f.server.alias });
    expect(response.body).not.toContain('fixture-replacement-secret');
    expect(await f.passwords.load(connectionIdentity(f.server))).toBe('fixture-replacement-secret');
    expect(await readFile(path.join(f.root, 'servers.json'), 'utf8')).not.toContain('secret');
    expect(f.pool.generation(f.server.alias)).toBeGreaterThan(before);
    expect(await f.pool.credentialStatus(f.server.alias)).toMatchObject({
      saved: true,
      connected: false,
      hasPassword: false,
      paused: true,
    });
    await expect(f.pool.resolveConnection({ alias: f.server.alias })).rejects.toMatchObject({
      code: 'connection_paused',
    });
    const current = response.json<ManagedServer>();
    expect(
      (
        await f.edit(oldRevision, {
          expected: current,
          input: { ...input, name: current.name },
          password: 'fixture-stale-secret',
        })
      ).statusCode,
    ).toBe(409);
    expect(await f.passwords.load(connectionIdentity(f.server))).toBe('fixture-replacement-secret');
  });

  it('新服务器可直接设置密码，保存响应及普通档案无明文且不尝试连接', async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/ssh-targets/with-password',
      headers: f.headers,
      payload: { input: { ...input, hostname: 'new.invalid' }, password: 'fixture-new-secret', confirmed: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const added = response.json<ManagedServer>();
    expect(added).toMatchObject({ hostname: 'new.invalid', authMode: 'password' });
    expect(added).not.toHaveProperty('password');
    expect(await f.passwords.load(connectionIdentity(added))).toBe('fixture-new-secret');
    expect(await f.pool.credentialStatus(added.alias)).toMatchObject({
      saved: true,
      connected: false,
      hasPassword: false,
      paused: true,
    });
  });

  it('未保存时回显null；清空字段显式删除保存项，不把空白当作复用', async () => {
    const f = await fixture();
    expect((await f.read()).json()).toMatchObject({ password: null, savingAvailable: true });
    await f.passwords.save(connectionIdentity(f.server), 'fixture-existing-secret');
    const response = await f.edit(await revision(f), { password: null });
    expect(response.statusCode).toBe(200);
    expect(await f.passwords.load(connectionIdentity(f.server))).toBeUndefined();
    expect(await f.pool.credentialStatus(f.server.alias)).toMatchObject({
      saved: false,
      connected: false,
      paused: true,
    });
  });

  it('跨目标revision、已变化的原始快照、断开后的旧revision不能覆盖密码', async () => {
    const f = await fixture();
    const other = await f.targets.save({ ...input, hostname: 'other.invalid' });
    const oldRevision = await revision(f);
    expect(
      (
        await f.edit(oldRevision, {
          expected: other,
          input: { ...input, hostname: 'other.invalid' },
          password: 'fixture-wrong-target',
        })
      ).statusCode,
    ).toBe(409);
    for (const patch of [
      { hostname: 'other.invalid' },
      { username: 'other' },
      { port: 2222 },
      { alias: other.alias },
      { hostname: 'EXAMPLE.INVALID' },
    ]) {
      const response = await f.app.inject({
        method: 'POST',
        url: `/api/ssh-targets/${f.server.alias}/password/read`,
        headers: f.headers,
        payload: { expected: { ...f.server, ...patch } },
      });
      expect(response.statusCode).toBe(409);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    f.pool.disconnect(f.server.alias);
    const rejected = await f.edit(oldRevision, { password: 'fixture-stale-secret' });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.body).not.toContain('fixture-stale-secret');
    expect(await f.passwords.has(connectionIdentity(f.server))).toBe(false);
    expect(await f.passwords.has(connectionIdentity(other))).toBe(false);
  });

  it('活动工作区、远端文件和同步收尾锁阻止保存；读取不打断活动', async () => {
    const f = await fixture();
    const workspace = await f.store.create({
      name: '项目',
      localDir: f.root,
      remoteDir: '~/projects/demo',
      sshHost: f.server.alias,
    });
    const release = f.activity.acquire(workspace.id);
    const bound = await revision(f);
    const before = f.pool.generation(f.server.alias);
    expect((await f.edit(bound, { password: 'fixture-blocked-secret' })).json()).toMatchObject({ code: 'target_busy' });
    release();
    for (const code of ['sync_busy', 'sync_task_pending', 'file_editor_open'] as const) {
      // 资源阻塞代码对档案服务不透明；只要存在阻塞项即拒绝。
      f.blockers.push({ code, message: '合成活动任务' });
      expect((await f.edit(bound, { password: 'fixture-blocked-secret' })).statusCode).toBe(409);
      f.blockers.pop();
    }
    expect(f.pool.generation(f.server.alias)).toBe(before);
    expect(await f.passwords.has(connectionIdentity(f.server))).toBe(false);
  });

  it('目标改变未明确提供新密码时，不沿用原目标或目的地遗留密文', async () => {
    const f = await fixture();
    await f.passwords.save(connectionIdentity(f.server), 'fixture-existing-secret');
    await f.passwords.save(JSON.stringify(['new.invalid', 22, 'demo']), 'fixture-destination-secret');
    const response = await f.edit(await revision(f), { input: { ...input, hostname: 'new.invalid' } });
    expect(response.statusCode).toBe(200);
    const next = response.json<ManagedServer>();
    expect(await f.passwords.load(connectionIdentity(next))).toBeUndefined();
    expect((await f.read(next)).json()).toMatchObject({ password: null });
  });

  it('解密期间的代次变化拒绝迟到明文，固定错误不暴露系统异常', async () => {
    const f = await fixture();
    await f.passwords.save(connectionIdentity(f.server), 'fixture-existing-secret');
    const entered = deferred();
    const gate = deferred();
    const decrypt = f.protector.unprotect.bind(f.protector);
    vi.spyOn(f.protector, 'unprotect').mockImplementationOnce(async (data, entropy) => {
      entered.resolve();
      await gate.promise;
      return decrypt(data, entropy);
    });
    const reading = f.read().then((response) => response);
    // 缺少接口时先报告404，而不是让缺少的解密调用挂起测试。
    const started = await Promise.race([entered.promise.then(() => true), reading.then(() => false)]);
    expect(started).toBe(true);
    f.pool.disconnect(f.server.alias);
    gate.resolve();
    const response = await reading;
    expect(response.statusCode).toBe(409);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain('fixture-existing-secret');
    vi.mocked(f.protector.unprotect).mockRejectedValueOnce(new Error('fixture-existing-secret-in-error'));
    const failed = await f.read();
    expect(failed.statusCode).toBe(409);
    expect(failed.body).not.toContain('fixture-existing-secret');
  });

  it('加密中被断开则回滚，既不改密码也不发布新档案', async () => {
    const f = await fixture();
    await f.passwords.save(connectionIdentity(f.server), 'fixture-existing-secret');
    const bound = await revision(f);
    const entered = deferred();
    const gate = deferred();
    const protect = f.protector.protect.bind(f.protector);
    vi.spyOn(f.protector, 'protect').mockImplementationOnce(async (data, entropy) => {
      entered.resolve();
      await gate.promise;
      return protect(data, entropy);
    });
    const saving = f
      .edit(bound, { input: { ...input, name: '不应发布' }, password: 'fixture-late-secret' })
      .then((response) => response);
    await entered.promise;
    f.pool.disconnect(f.server.alias);
    gate.resolve();
    expect((await saving).statusCode).toBe(409);
    expect(await f.targets.get(f.server.alias)).toEqual(f.server);
    expect(await f.passwords.load(connectionIdentity(f.server))).toBe('fixture-existing-secret');
  });

  it('读取和保存均经过本机会话/Origin保护，包括被拒请求也no-store', async () => {
    const f = await fixture();
    for (const [headers, status] of [
      [{ ...f.headers, cookie: '' }, 401],
      [{ ...f.headers, origin: 'https://other.invalid' }, 403],
      [{ ...f.headers, origin: '' }, 403],
    ] as const) {
      for (const method of ['POST', 'PUT'] as const) {
        const response = await f.app.inject({
          method,
          url: `/api/ssh-targets/${f.server.alias}/password${method === 'POST' ? '/read' : ''}`,
          headers,
          payload: { expected: f.server },
        });
        expect(response.statusCode).toBe(status);
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
  });

  it('凭据请求严格校验确认、格式及查询参数，私钥档案不接受密码', async () => {
    const f = await fixture();
    const bound = await revision(f);
    const payload = { input, expected: f.server, revision: bound, password: 'fixture-secret', confirmed: true };
    for (const patch of [
      { confirmed: false },
      { confirmed: undefined },
      { password: '' },
      { password: 'line\nsecret' },
      { extra: true },
      { input: { ...input, authMode: 'key' } },
    ]) {
      const response = await f.app.inject({
        method: 'PUT',
        url: `/api/ssh-targets/${f.server.alias}/password`,
        headers: f.headers,
        payload: { ...payload, ...patch },
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('fixture-secret');
    }
    const query = await f.app.inject({
      method: 'POST',
      url: `/api/ssh-targets/${f.server.alias}/password/read?all=true`,
      headers: f.headers,
      payload: { expected: f.server },
    });
    expect(query.statusCode).toBe(400);
    expect(await f.passwords.has(connectionIdentity(f.server))).toBe(false);
  });
});

it.each(['save', 'forget'] as const)('密文存储%s变更也使旧编辑revision失效，不能覆盖新一代凭据', async (operation) => {
  const f = await fixture();
  const identity = connectionIdentity(f.server);
  await f.passwords.save(identity, 'fixture-first-secret');
  const bound = await revision(f);
  if (operation === 'save') await f.passwords.save(identity, 'fixture-second-secret');
  else await f.passwords.forget(identity);
  const response = await f.edit(bound, { password: 'fixture-stale-secret' });
  expect(response.statusCode).toBe(409);
  expect(await f.passwords.load(identity)).toBe(operation === 'save' ? 'fixture-second-secret' : undefined);
});

it('发布档案后请求失效也同时恢复档案和原密文', async () => {
  const f = await fixture();
  const identity = connectionIdentity(f.server);
  await f.passwords.save(identity, 'fixture-original-secret');
  const bound = await revision(f);
  let current = true;
  await expect(
    f.targets.update(f.server.alias, { ...input, name: '不可保留' }, f.server, {
      commit: (server, next, publish) =>
        f.pool.commitServerEdit({
          next,
          expected: { server, revision: bound },
          password: 'fixture-rollback-secret',
          stillCurrent: () => current,
          commit: async () => {
            await publish();
            current = false;
          },
        }),
    }),
  ).rejects.toMatchObject({ code: 'credential_operation_cancelled' });
  expect(await f.targets.get(f.server.alias)).toEqual(f.server);
  expect(await f.passwords.load(identity)).toBe('fixture-original-secret');
});

it('新服务器加密失败不留下半份档案、密码或系统异常正文', async () => {
  const f = await fixture();
  vi.spyOn(f.protector, 'protect').mockRejectedValueOnce(new Error('fixture-new-secret-system-error'));
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/ssh-targets/with-password',
    headers: f.headers,
    payload: { input: { ...input, hostname: 'new.invalid' }, password: 'fixture-new-secret', confirmed: true },
  });
  expect(response.statusCode).toBe(409);
  expect(response.body).not.toContain('fixture-new-secret');
  expect(await f.targets.list()).toEqual([f.server]);
  expect(await f.passwords.has(JSON.stringify(['new.invalid', 22, 'demo']))).toBe(false);
});

it('携带新密码也不能绕过被引用连接目标的变更限制', async () => {
  const f = await fixture();
  await f.store.create({ name: '项目', localDir: f.root, remoteDir: '~/projects/demo', sshHost: f.server.alias });
  const response = await f.edit(await revision(f), {
    input: { ...input, hostname: 'other.invalid' },
    password: 'fixture-new-secret',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'target_referenced' });
  expect(await f.targets.get(f.server.alias)).toEqual(f.server);
  expect(await f.passwords.has(JSON.stringify(['other.invalid', 22, 'demo']))).toBe(false);
});

it.each(['read', 'save'] as const)('HTTP取消%s时，迟到解密或保存不能恢复敏感操作', async (operation) => {
  const f = await fixture();
  await f.passwords.save(connectionIdentity(f.server), 'fixture-original-secret');
  const bound = await revision(f);
  const entered = deferred();
  const gate = deferred();
  const closed = deferred();
  const method = operation === 'read' ? 'unprotect' : 'protect';
  const original = f.protector[method].bind(f.protector);
  vi.spyOn(f.protector, method).mockImplementationOnce(async (data, entropy) => {
    entered.resolve();
    await gate.promise;
    return original(data, entropy);
  });
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  f.app.server.on('request', (_request, response) => response.once('close', () => closed.resolve()));
  const port = (f.app.server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const suffix = operation === 'read' ? '/read' : '';
  const payload =
    operation === 'read'
      ? { expected: f.server }
      : {
          input: { ...input, name: '不应发布' },
          expected: f.server,
          revision: bound,
          password: 'fixture-late-secret',
          confirmed: true,
        };
  const pending = fetch(`${origin}/api/ssh-targets/${f.server.alias}/password${suffix}`, {
    method: operation === 'read' ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json', origin, cookie: f.headers.cookie },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).catch(() => undefined);
  try {
    await entered.promise;
    controller.abort();
    await closed.promise;
  } finally {
    gate.resolve();
  }
  expect(await pending).toBeUndefined();
  expect(await f.targets.get(f.server.alias)).toEqual(f.server);
  expect(await f.passwords.load(connectionIdentity(f.server))).toBe('fixture-original-secret');
});
