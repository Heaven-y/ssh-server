import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import ssh2 from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteBrowseSession, RemoteDirectory } from '@ssh-server/shared';
import { registerRemoteFileRoutes } from '../../src/http/remote-files.routes';
import { createRemoteFilesService } from '../../src/remote-files/service';
import { startRemoteSftpFixture, type RemoteSftpFixture } from '../helpers/remote-sftp';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const remote = await startRemoteSftpFixture();
  const store = {
    get: async (id: string) => (id === remote.workspace.id ? structuredClone(remote.workspace) : undefined),
  };
  const service = createRemoteFilesService({ store, pool: remote.pool });
  cleanup.push(async () => {
    service.dispose();
    await remote.close();
  });
  const bind = () => service.binding(remote.workspace.id, remote.target);
  const open = async () => service.open(remote.workspace.id, { ...remote.target, ...(await bind()) });
  return { ...remote, service, bind, open };
}

async function released(remote: RemoteSftpFixture) {
  await vi.waitFor(
    () => {
      expect(remote.resources().channels).toBe(0);
      expect(remote.resources().handles).toBe(0);
    },
    { timeout: 2000 },
  );
}

function httpApp(service: ReturnType<typeof createRemoteFilesService>) {
  const app = Fastify();
  registerRemoteFileRoutes(app, service);
  cleanup.push(() => app.close());
  return app;
}

async function openHttp(app: FastifyInstance, remote: RemoteSftpFixture) {
  const base = `/api/workspaces/${remote.workspace.id}/remote-files`;
  const bound = await app.inject({ method: 'POST', url: `${base}/bindings`, payload: remote.target });
  expect(bound.statusCode).toBe(200);
  expect(bound.headers['cache-control']).toBe('no-store');
  const binding = bound.json<{ binding: string }>().binding;
  const opened = await app.inject({ method: 'POST', url: `${base}/sessions`, payload: { ...remote.target, binding } });
  expect(opened.statusCode).toBe(200);
  return { base, binding, session: opened.json<RemoteBrowseSession>() };
}

describe('真实 SFTP 服务器目录集成', () => {
  it('目标绑定不连接 SSH；跨同步根逐页浏览只读元数据，关闭释放目录资源', async () => {
    const remote = await fixture();
    const original = structuredClone(remote.workspace);
    const binding = await remote.bind();
    expect(binding.binding).toMatch(/^[a-f0-9]{64}$/);
    expect(remote.audit.connections).toBe(0);
    const session = await remote.service.open(remote.workspace.id, { ...remote.target, ...binding });
    expect(session).toMatchObject({ home: remote.home, root: remote.root });
    const local = await remote.service.list(remote.workspace.id, session.id, { path: '' });
    expect(local.entries.find((entry) => entry.name === 'train.py')).toMatchObject({ type: 'file', scope: 'included' });
    expect(local.entries.find((entry) => entry.name === 'dataset-link')).toMatchObject({ type: 'link', scope: 'link' });
    const first = await remote.service.list(remote.workspace.id, session.id, { path: remote.outside });
    expect(first).toMatchObject({ path: remote.outside, root: remote.root, outsideWorkspace: true });
    expect(first.entries).toHaveLength(200);
    expect(first.entries.every((entry) => entry.scope === 'outside')).toBe(true);
    expect(first.nextCursor).toBeTypeOf('string');
    const input = { path: remote.outside, cursor: first.nextCursor };
    const second = await remote.service.list(remote.workspace.id, session.id, input);
    expect(second.entries).toHaveLength(37);
    expect(second.nextCursor).toBeUndefined();
    expect(await remote.service.list(remote.workspace.id, session.id, input)).toEqual(second);
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.path)).size).toBe(237);
    expect(remote.workspace).toEqual(original);
    expect(remote.audit.bodyReads).toBe(0);
    expect(remote.audit.commands).toBe(0);
    await remote.service.list(remote.workspace.id, session.id, { path: remote.outside });
    remote.service.close(remote.workspace.id, session.id);
    await released(remote);
    expect(remote.audit.handlesClosed).toBe(remote.audit.handlesOpened);
    remote.pool.disconnect(remote.workspace.sshHost);
    await vi.waitFor(() => expect(remote.resources().peers).toBe(0));
  }, 15_000);

  it.each(['实际地址', '账号', '信任记录'] as const)(
    '同 Host 的%s变化后旧面板不能重连，新绑定才能打开',
    async (change) => {
      const remote = await fixture();
      const previous = await remote.bind();
      if (change === '实际地址') {
        const next = await startRemoteSftpFixture();
        cleanup.push(() => next.close());
        remote.changeIdentity({ port: next.port });
        remote.changeTrust(next.trust());
      } else if (change === '账号') remote.changeIdentity({ username: 'other-demo' });
      else {
        const additional = ssh2.utils.generateKeyPairSync('ecdsa', { bits: 256 });
        remote.changeTrust(remote.trust() + `[127.0.0.1]:${remote.port} ${additional.public}\n`);
      }
      await expect(remote.service.open(remote.workspace.id, { ...remote.target, ...previous })).rejects.toMatchObject({
        code: 'target_changed',
      });
      expect(remote.audit.connections).toBe(0);
      const fresh = await remote.bind();
      expect(fresh.binding).not.toBe(previous.binding);
      await remote.authenticate();
      const session = await remote.service.open(remote.workspace.id, { ...remote.target, ...fresh });
      expect((await remote.service.list(remote.workspace.id, session.id, { path: '' })).path).toBe(remote.root);
    },
    15_000,
  );

  it('取消慢目录请求及时释放通道，同一会话可继续导航且复用 SSH 连接', async () => {
    const remote = await fixture();
    const session = await remote.open();
    const gate = remote.holdNext('READDIR');
    const controller = new AbortController();
    const pending = remote.service.list(remote.workspace.id, session.id, { path: remote.slow }, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await gate.entered;
    const started = performance.now();
    controller.abort();
    await rejection;
    expect(performance.now() - started).toBeLessThan(1500);
    await released(remote);
    const directory = await remote.service.list(remote.workspace.id, session.id, { path: remote.root });
    expect(directory.path).toBe(remote.root);
    expect(remote.audit.connections).toBe(1);
    expect(remote.audit.authentications).toBe(1);
    gate.release();
    expect(remote.audit.bodyReads).toBe(0);
  }, 15_000);

  it('HTTP 绑定、分页与关闭经过真实 SFTP，拒绝未知字段和错工作区并隐藏内部诊断', async () => {
    const remote = await fixture();
    const app = httpApp(remote.service);
    const { base, binding, session } = await openHttp(app, remote);
    const url = `${base}/sessions/${session.id}`;
    const first = await app.inject(`${url}?path=${encodeURIComponent(remote.outside)}`);
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const page = first.json<RemoteDirectory>();
    expect(page.entries).toHaveLength(200);
    const second = await app.inject(`${url}?path=${encodeURIComponent(remote.outside)}&cursor=${page.nextCursor}`);
    expect(second.json<RemoteDirectory>().entries).toHaveLength(37);
    const invalid = await Promise.all([
      app.inject({ method: 'POST', url: `${base}/bindings`, payload: { ...remote.target, extra: true } }),
      app.inject({ method: 'POST', url: `${base}/sessions`, payload: { ...remote.target, binding, extra: true } }),
      app.inject(`${url}?extra=true`),
    ]);
    for (const response of invalid) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
    }
    const wrong = await app.inject(`/api/workspaces/other-workspace/remote-files/sessions/${session.id}`);
    expect(wrong.json()).toMatchObject({ code: 'session_expired' });
    const denied = await app.inject(`${url}?path=${encodeURIComponent(remote.denied)}`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'permission_denied' });
    expect(denied.body).not.toContain(remote.privateDiagnostic);
    const link = await app.inject(`${url}?path=${encodeURIComponent(path.posix.join(remote.root, 'dataset-link'))}`);
    expect(link.json()).toMatchObject({ code: 'not_directory' });
    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(204);
    expect((await app.inject(url)).json()).toMatchObject({ code: 'session_expired' });
    await released(remote);
    expect(remote.audit.bodyReads).toBe(0);
  }, 15_000);

  it('真实 HTTP 请求中止会取消目录读取，并清理取消后迟到的 SFTP 通道', async () => {
    const remote = await fixture();
    const app = httpApp(remote.service);
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const { base, binding, session } = await openHttp(app, remote);
    const gate = remote.holdNext('READDIR');
    const controller = new AbortController();
    const reading = fetch(`${origin}${base}/sessions/${session.id}?path=${encodeURIComponent(remote.slow)}`, {
      signal: controller.signal,
    });
    const readAborted = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await gate.entered;
    controller.abort();
    await readAborted;
    await released(remote);
    gate.release();
    expect((await app.inject(`${base}/sessions/${session.id}`)).statusCode).toBe(200);
    await released(remote);
    const openedBefore = remote.audit.channelsOpened;
    const opening = remote.holdNext('SFTP');
    const cancelOpen = new AbortController();
    const pending = fetch(`${origin}${base}/sessions`, {
      method: 'POST',
      signal: cancelOpen.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...remote.target, binding }),
    });
    const openAborted = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await opening.entered;
    cancelOpen.abort();
    await openAborted;
    opening.release();
    await vi.waitFor(() => expect(remote.audit.channelsOpened).toBeGreaterThan(openedBefore));
    await released(remote);
    expect(remote.audit.channelsOpened).toBe(remote.audit.channelsClosed);
    expect(remote.audit.connections).toBe(1);
  }, 15_000);
});
