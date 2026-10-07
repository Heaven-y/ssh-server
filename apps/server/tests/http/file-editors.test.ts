import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import { afterEach, expect, it } from 'vitest';
import type { FileEditorServerMessage } from '@ssh-server/shared';
import { createFileEditors } from '../../src/files/editors';
import { buildApp } from '../../src/http/app';
import { registerFileEditorRoutes } from '../../src/http/file-editors.routes';
import { SESSION_COOKIE } from '../../src/http/security';
import type { PreparedAction } from '../../src/remote-files/preflight';

const token = 'file-editor-route-fixture';
const directories: string[] = [];
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];
function decode(data: RawData): FileEditorServerMessage {
  const source = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
  return JSON.parse(source.toString('utf8')) as FileEditorServerMessage;
}
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-editor-routes-'));
  directories.push(directory);
  const editors = createFileEditors(directory);
  const workspace = {
    id: 'a',
    name: 'fixture',
    sshHost: 'my-server',
    localDir: directory,
    remoteDir: '~/projects/demo',
  };
  const store: Parameters<typeof buildApp>[0]['store'] = {
    withSnapshot: async (operation) => operation([workspace]),
    list: async () => [],
    get: async (id: string) => (id === 'a' ? workspace : undefined),
    create: async () => {
      throw new Error('fixture_read_only');
    },
    update: async () => undefined,
    remove: async () => false,
  };
  const app = await buildApp({
    token,
    port: 0,
    store,
    routes: (app) => registerFileEditorRoutes(app, { store, editors }),
  });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;
  const headers = {
    host: `127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    cookie: `${SESSION_COOKIE}=${token}`,
  };
  function connect(workspace: string, editorId: string) {
    const messages: FileEditorServerMessage[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/workspaces/${workspace}/file-editors/${editorId}`, {
      headers,
    });
    sockets.push(socket);
    socket.on('message', (data) => messages.push(decode(data)));
    return { socket, messages };
  }
  return { app, editors, headers, directory, connect };
}

it('真实握手报告最新脏缓冲，断线登记保留且只能严格确认后清除', async () => {
  const { app, editors, headers, directory, connect } = await setup();
  const id = randomUUID();
  const { socket, messages } = connect('a', id);
  await expect.poll(() => messages).toContainEqual({ type: 'ready' });
  socket.send(JSON.stringify({ type: 'state', state: { path: 'code.py', dirty: false, busy: false } }));
  socket.on('message', (data) => {
    const message = decode(data);
    if (message.type === 'reserve')
      socket.send(
        JSON.stringify({
          type: 'reserved',
          token: message.token,
          state: { path: 'code.py', dirty: true, busy: false },
        }),
      );
  });
  // 等状态进入服务端消息队列，再验证操作时重新取最新缓冲状态。
  await expect
    .poll(async () => {
      try {
        const release = await editors.reserve(
          { public: { affectedWorkspaces: [{ id: 'a' }] } } as PreparedAction,
          new AbortController().signal,
        );
        release();
        return 'allowed';
      } catch (error) {
        return (error as { code: string }).code;
      }
    })
    .toBe('editor_dirty');
  socket.close();
  const base = '/api/workspaces/a/file-editors';
  await expect
    .poll(async () => (await app.inject({ url: base, headers })).json<{ editors: string[] }>())
    .toEqual({ editors: [id] });
  expect((await app.inject({ url: base, headers })).headers['cache-control']).toBe('no-store');
  expect((await app.inject({ url: `${base}?extra=1`, headers })).statusCode).toBe(400);
  for (const payload of [{ confirmed: false }, { confirmed: true, extra: 1 }]) {
    expect((await app.inject({ method: 'DELETE', url: `${base}/${id}`, headers, payload })).statusCode).toBe(400);
  }
  expect(JSON.parse(await readFile(path.join(directory, 'file-editors.json'), 'utf8'))).toEqual([
    { id, workspaceId: 'a' },
  ]);
  expect(
    (await app.inject({ method: 'DELETE', url: `${base}/${id}`, headers, payload: { confirmed: true } })).json(),
  ).toEqual({ forgotten: true });
  expect((await app.inject({ url: base, headers })).json()).toEqual({ editors: [] });
});

it('未知工作区、非法登记和携带正文或超限的消息关闭连接，不清除未知缓冲登记', async () => {
  const { editors, connect } = await setup();
  for (const [workspace, id] of [
    ['a', 'invalid-id'],
    ['missing', randomUUID()],
  ]) {
    const { socket } = connect(workspace!, id!);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    expect(await closed).toBe(1008);
  }
  for (const source of [
    JSON.stringify({ type: 'state', state: { path: 'code.py', dirty: false, busy: false, content: 'secret' } }),
    'x'.repeat(16_385),
  ]) {
    const id = randomUUID();
    const { socket, messages } = connect('a', id);
    await expect.poll(() => messages).toContainEqual({ type: 'ready' });
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(source);
    expect(await closed).toBe(1008);
    await expect.poll(() => editors.disconnected('a')).toContain(id);
  }
});
