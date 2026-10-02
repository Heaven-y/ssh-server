import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentConfigRoutes } from '../../src/http/agent-config.routes';
import { NativeConfigError } from '../../src/settings/errors';
import type { NativeConfigDocument, NativeConfigService } from '../../src/settings/native-config';

const document: NativeConfigDocument = {
  agent: 'codex',
  displayPath: '~/.codex/config.toml',
  format: 'toml',
  content: '# 配置\n',
  revision: 'a'.repeat(64),
  exists: true,
};
const apps: FastifyInstance[] = [];
function setup() {
  const app = Fastify();
  apps.push(app);
  const service: NativeConfigService = {
    read: vi.fn(async () => document),
    save: vi.fn(async () => document),
  };
  registerAgentConfigRoutes(app, { service });
  return { app, service };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('原生配置接口', () => {
  it('GET / PUT 转发受限参数并禁止缓存', async () => {
    const { app, service } = setup();
    const read = await app.inject({ method: 'GET', url: '/api/agent-config/codex' });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(document);
    expect(read.headers['cache-control']).toBe('no-store');
    const input = { content: '# 配置\n', revision: document.revision };
    const save = await app.inject({ method: 'PUT', url: '/api/agent-config/codex', payload: input });
    expect(save.statusCode).toBe(200);
    expect(save.headers['cache-control']).toBe('no-store');
    expect(service.read).toHaveBeenCalledWith('codex');
    expect(service.save).toHaveBeenCalledWith('codex', input);
  });

  it('拒绝其他 Agent、任意路径参数和不完整请求', async () => {
    const { app, service } = setup();
    const requests = [
      { method: 'GET' as const, url: '/api/agent-config/other' },
      { method: 'GET' as const, url: '/api/agent-config/codex?path=other.toml' },
      { method: 'PUT' as const, url: '/api/agent-config/codex', payload: { content: '' } },
      {
        method: 'PUT' as const,
        url: '/api/agent-config/codex',
        payload: { content: '', revision: 'missing', path: 'other.toml' },
      },
    ];
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(400);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(service.read).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('已知冲突保持状态码，系统错误与 HTTP 解析错误均隐藏原文', async () => {
    const { app, service } = setup();
    vi.mocked(service.save).mockRejectedValueOnce(new NativeConfigError('revision_conflict'));
    const conflict = await app.inject({
      method: 'PUT',
      url: '/api/agent-config/codex',
      payload: { content: '', revision: 'missing' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'revision_conflict' });
    vi.mocked(service.read).mockRejectedValueOnce(new Error('secret-sentinel'));
    const failed = await app.inject({ method: 'GET', url: '/api/agent-config/codex' });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('secret-sentinel');
    const malformed = await app.inject({
      method: 'PUT',
      url: '/api/agent-config/codex',
      headers: { 'content-type': 'application/json' },
      payload: '{"secret-sentinel": malformed}',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('secret-sentinel');
    for (const response of [conflict, failed, malformed]) expect(response.headers['cache-control']).toBe('no-store');
  });
});
