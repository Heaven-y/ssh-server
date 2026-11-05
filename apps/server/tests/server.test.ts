// 可编程启动：桌面壳与 CLI 共用同一个 startServer，测试只验证端口、访问与关闭。
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProcessRunner } from '../src/process/run';
import { startServer, type StartedServer } from '../src/server';

// 探测用假执行器：立刻以非零状态退出，避免测试启动本机真实 CLI。
const inertRunner: ProcessRunner = async () => ({
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  exitCode: 1,
});

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup().catch(() => undefined)));
});

async function fixture(): Promise<{ configDir: string; legacyDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentdeck-start-server-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return { configDir: path.join(root, 'config'), legacyDir: path.join(root, 'legacy') };
}

async function launch(configDir: string, legacyDir: string): Promise<StartedServer> {
  const server = await startServer(
    { port: 0, host: '127.0.0.1', configDir, token: 'test-token' },
    {
      legacyDir,
      probeRunner: inertRunner,
      log: () => undefined,
      logError: () => undefined,
    },
  );
  cleanups.push(() => server.close());
  return server;
}

/** 直接连端口，避免 fetch 连接池掩盖“端口已关闭”。 */
function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('startServer', () => {
  it('监听端口占用时保留原始启动错误', async () => {
    const { configDir, legacyDir } = await fixture();
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('夹具没有监听端口');
    await expect(
      startServer(
        { port: address.port, host: '127.0.0.1', configDir, token: 'test-token' },
        {
          legacyDir,
          probeRunner: inertRunner,
          log: () => undefined,
          logError: () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
  it('返回可访问的本机地址，close 后端口不再监听', async () => {
    const { configDir, legacyDir } = await fixture();
    const server = await launch(configDir, legacyDir);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    // 同源 POST 需带 Origin，与浏览器一致；这也是访问控制的一部分。
    const origin = new URL(server.url).origin;
    const response = await fetch(new URL('api/local-session', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: '{}',
    });
    expect(response.status).toBe(204);
    const port = Number(new URL(server.url).port);
    expect(await portIsOpen(port)).toBe(true);

    await server.close();
    expect(await portIsOpen(port)).toBe(false);
  });

  it('close 可重复调用且只关闭一次', async () => {
    const { configDir, legacyDir } = await fixture();
    const server = await launch(configDir, legacyDir);
    await Promise.all([server.close(), server.close()]);
    await expect(server.close()).resolves.toBeUndefined();
  });
});
