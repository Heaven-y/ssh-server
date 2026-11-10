import Fastify from 'fastify';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { registerSessionToolsRoutes } from '../../src/http/session-tools.routes';
import { createSessionToolsService } from '../../src/settings/session-tools';
import { SessionError } from '../../src/agents/errors';

it('API 严格校验参数、禁止缓存，运行中明确 409 且不写配置，空闲启停可读回', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'session-tools-route-'));
  const app = Fastify();
  let busy = true;
  const service = createSessionToolsService({
    homeDir: root,
    configDir: root,
    environment: async () => ({}),
    command: { command: process.execPath, args: [path.join(root, 'tool.mjs')] },
    resolveCommand: () => ({ command: process.execPath, args: [] }),
    withIdleAgent: async (_agent, operation) => {
      if (busy) throw new SessionError(409, 'agent_busy', 'CLI 正在运行');
      return operation();
    },
  });
  registerSessionToolsRoutes(app, { service });
  try {
    for (const url of ['/api/session-tools/unknown', '/api/session-tools/codex?path=bad']) {
      const invalid = await app.inject({ url });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.headers['cache-control']).toBe('no-store');
    }
    const status = await app.inject({ url: '/api/session-tools/codex' });
    expect(status.json()).toMatchObject({ agent: 'codex', enabled: false, available: true });
    const payload = { enabled: true, revision: status.json().revision };
    const blocked = await app.inject({ method: 'PUT', url: '/api/session-tools/codex', payload });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('agent_busy');
    await expect(stat(path.join(root, '.codex'))).rejects.toMatchObject({ code: 'ENOENT' });
    busy = false;
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/session-tools/codex',
      payload: { ...payload, command: 'bad' },
    });
    expect(invalid.statusCode).toBe(400);
    const enabled = await app.inject({ method: 'PUT', url: '/api/session-tools/codex', payload });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().enabled).toBe(true);
    expect(enabled.headers['cache-control']).toBe('no-store');
    const conflict = await app.inject({ method: 'PUT', url: '/api/session-tools/codex', payload });
    expect(conflict.statusCode).toBe(409);
    const malformed = await app.inject({
      method: 'PUT',
      url: '/api/session-tools/codex',
      headers: { 'content-type': 'application/json' },
      payload: '{"secret-body"',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('secret-body');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('便携版 API 返回不可用原因，PUT 固定 409 且不创建原生配置', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'session-tools-portable-'));
  const app = Fastify();
  registerSessionToolsRoutes(app, {
    service: createSessionToolsService({
      homeDir: root,
      configDir: root,
      registrationAvailable: false,
      environment: async () => ({}),
      command: { command: process.execPath, args: [path.join(root, 'tool.mjs')] },
      resolveCommand: () => ({ command: process.execPath, args: [] }),
    }),
  });
  try {
    const status = await app.inject({ url: '/api/session-tools/codex' });
    expect(status.json()).toMatchObject({
      available: false,
      message: '便携版的运行目录会变化，请使用安装版启用会话读取。',
    });
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/session-tools/codex',
      payload: { enabled: true, revision: status.json().revision },
    });
    expect(saved.statusCode).toBe(409);
    expect(saved.json().code).toBe('unsupported_runtime');
    expect(await readdir(root)).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
