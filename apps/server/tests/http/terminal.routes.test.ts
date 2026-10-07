import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';
import { workspaceTerminalTarget, type TerminalServerMessage } from '@ssh-server/shared';
import { startTerminalFixture } from '../../../../scripts/dev/terminal-fixture';
import { buildApp } from '../../src/http/app';
import { registerTerminalRoutes } from '../../src/http/terminal.routes';
import { createTerminalBindings } from '../../src/terminal/binding';
import { createTerminalManager } from '../../src/terminal/manager';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terminal-http-'));
  const ssh = await startTerminalFixture({
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(root, 'workspace'),
  });
  const bindings = createTerminalBindings(ssh);
  const terminals = createTerminalManager({ ...ssh, bindings });
  const app = await buildApp({
    token: 'fixture-token',
    port: 0,
    store: ssh.store,
    routes: (app) => {
      registerTerminalRoutes(app, { terminals, bindings });
      app.get('/ws', { websocket: true }, (socket) => {
        socket.on('message', (data) => socket.send(data));
      });
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const origin = app.listeningOrigin;
  const headers = { host: new URL(origin).host, origin, cookie: 'ssh_server_session=fixture-token' };
  const connect = (url: string) =>
    new WebSocket(new URL(url, origin).href.replace(/^http/, 'ws'), { origin, headers: { cookie: headers.cookie } });
  return {
    ...ssh,
    app,
    origin,
    headers,
    connect,
    bindings,
    terminals,
    async close() {
      terminals.dispose();
      await app.close();
      await ssh.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
it('活跃终端在正常app.close的preClose阶段回收，不等待外部断开', async () => {
  const f = await fixture();
  const socket = f.connect(`/api/workspaces/${f.workspace.id}/terminal`);
  try {
    socket.on('error', () => undefined);
    await once(socket, 'open');
    const closed = f.app.close();
    let finished = false;
    void closed.then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(finished).toBe(true), { timeout: 600 });
    await closed;
  } finally {
    socket.terminate();
    await f.close();
  }
});
it('真实握手/SFTP/PTY、最终输出和退出码贯通同一目标；错误Origin拒绝升级', async () => {
  const f = await fixture();
  const controls: TerminalServerMessage[] = [];
  const output: Buffer[] = [];
  const socket = f.connect(`/api/workspaces/${f.workspace.id}/terminal`);
  try {
    socket.on('error', () => undefined);
    socket.on('message', (bytes, binary) => {
      if (binary) {
        output.push(Buffer.from(bytes as Buffer));
        socket.send(JSON.stringify({ type: 'ack', bytes: (bytes as Buffer).length }));
      } else controls.push(JSON.parse(Buffer.from(bytes as Buffer).toString()) as TerminalServerMessage);
    });
    await once(socket, 'open');
    const target = workspaceTerminalTarget(f.workspace);
    const reply = await f.app.inject({
      method: 'POST',
      url: `/api/workspaces/${f.workspace.id}/terminal-binding`,
      headers: f.headers,
      payload: { target },
    });
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.statusCode).toBe(200);
    const invalid = await f.app.inject({
      method: 'POST',
      url: `/api/workspaces/${f.workspace.id}/terminal-binding`,
      headers: f.headers,
      payload: { target: { ...target, workspaceId: 'wrong' } },
    });
    expect(invalid.statusCode).toBe(400);
    const binding = reply.json<{ binding: string }>().binding;
    socket.send(JSON.stringify({ type: 'open', target, binding, size: { cols: 80, rows: 24 } }));
    await vi.waitFor(() => expect(controls.some((m) => m.type === 'ready')).toBe(true), { timeout: 4000 });
    socket.send(JSON.stringify({ type: 'input', data: Buffer.from('exit\n').toString('base64') }));
    await vi.waitFor(
      () =>
        expect(controls.find((m) => m.type === 'exit')).toEqual({
          type: 'exit',
          exitCode: 7,
          signal: null,
          outputComplete: true,
        }),
      { timeout: 4000 },
    );
    expect(Buffer.concat(output).toString()).toContain('中文');
    expect(Buffer.concat(output).toString()).toContain('最终输出');
    const denied = new WebSocket(`${f.origin.replace(/^http/, 'ws')}/api/workspaces/${f.workspace.id}/terminal`, {
      origin: 'http://example.invalid',
      headers: { cookie: f.headers.cookie },
    });
    const status = await new Promise<number>((resolve) => {
      denied.on('error', () => undefined);
      denied.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode!);
        response.destroy();
        denied.terminate();
      });
    });
    expect(status).toBe(403);
  } finally {
    socket.terminate();
    await f.close();
  }
}, 10000);
it('终端64KiB解析上限保留聊天的大帧兼容', async () => {
  const f = await fixture();
  const terminal = f.connect(`/api/workspaces/${f.workspace.id}/terminal`);
  const chat = f.connect('/ws');
  try {
    terminal.on('error', () => undefined);
    chat.on('error', () => undefined);
    await Promise.all([once(terminal, 'open'), once(chat, 'open')]);
    const closed = once(terminal, 'close');
    terminal.send(Buffer.alloc(65537), { binary: false });
    // 插件可在receiver错误时terminate，客户端因此可能观测到1006。
    expect([1006, 1009]).toContain((await closed)[0]);
    const echo = once(chat, 'message');
    chat.send('x'.repeat(70000));
    expect((await echo)[0]).toHaveLength(70000);
  } finally {
    terminal.terminate();
    chat.terminate();
    await f.close();
  }
}, 10000);
