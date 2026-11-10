import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CliInstallationStatus } from '@agentdeck/shared/settings';
import { buildApp } from '../../src/http/app';
import { registerCliInstallationRoutes } from '../../src/http/cli-installation.routes';
import { CliInstallationError } from '../../src/cli-installation/service-errors';

const apps: FastifyInstance[] = [];
const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', cookie: 'AGENTDECK_session=test-token' };
const url = '/api/settings/cli-installation/claude';
const state: CliInstallationStatus = {
  agent: 'claude',
  installed: true,
  currentVersion: '1.0.0',
  latestVersion: '2.0.0',
  source: 'npm',
  updateAvailable: true,
  canInstall: false,
  canUpdate: true,
  checkedAt: 1,
  revision: 'a'.repeat(64),
  phase: 'idle',
  operationId: null,
  message: null,
  guideUrl: 'https://example.com/guide',
};
async function fixture() {
  const service = {
    read: vi.fn(async () => state),
    check: vi.fn(async () => state),
    start: vi.fn(async () => ({ ...state, phase: 'updating' as const, operationId: 'operation' })),
    dispose: vi.fn(async () => undefined),
  };
  const app = await buildApp({
    token: 'test-token',
    port: 4317,
    routes: (app) => registerCliInstallationRoutes(app, { service }),
  });
  apps.push(app);
  return { app, service };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('CLI 安装路由边界', () => {
  it('普通读取不触发查新或安装，操作返回 202 并禁用缓存', async () => {
    const { app, service } = await fixture();
    const read = await app.inject({ url, headers });
    expect(read.statusCode).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(service.check).not.toHaveBeenCalled();
    expect(service.start).not.toHaveBeenCalled();
    const checked = await app.inject({ method: 'POST', url: `${url}/check`, headers, payload: {} });
    expect(checked.statusCode).toBe(200);
    const operation = await app.inject({
      method: 'POST',
      url: `${url}/operations`,
      headers,
      payload: { action: 'update', revision: state.revision },
    });
    expect(operation.statusCode).toBe(202);
    expect(operation.headers['cache-control']).toBe('no-store');
    expect(operation.json()).toMatchObject({ phase: 'updating', operationId: 'operation' });
  });

  it('未授权或跨站请求不能触发安装', async () => {
    const { app, service } = await fixture();
    for (const requestHeaders of [
      { ...headers, cookie: '' },
      { ...headers, origin: 'https://example.com' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `${url}/operations`,
        headers: requestHeaders,
        payload: { action: 'update', revision: state.revision },
      });
      expect([401, 403]).toContain(response.statusCode);
    }
    expect(service.start).not.toHaveBeenCalled();
  });

  it('拒绝任意路径命令版本、无效代理与查询参数，隐藏解析错误', async () => {
    const { app, service } = await fixture();
    for (const payload of [
      { action: 'update', revision: state.revision, command: 'private-command' },
      { action: 'update', revision: state.revision, version: '3.0.0' },
      { action: 'install', revision: 'missing' },
    ]) {
      const response = await app.inject({ method: 'POST', url: `${url}/operations`, headers, payload });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('private-command');
    }
    for (const target of ['/api/settings/cli-installation/unknown', `${url}?path=private-path`]) {
      expect((await app.inject({ url: target, headers })).statusCode).toBe(400);
    }
    const extra = await app.inject({ method: 'POST', url: `${url}/check`, headers, payload: { path: 'private-path' } });
    expect(extra.statusCode).toBe(400);
    const malformed = await app.inject({
      method: 'POST',
      url: `${url}/check`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{"private-body"',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.headers['cache-control']).toBe('no-store');
    expect(malformed.body).not.toContain('private-body');
    const oversized = await app.inject({
      method: 'POST',
      url: `${url}/check`,
      headers,
      payload: { text: 'x'.repeat(1_025) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(service.start).not.toHaveBeenCalled();
    expect(service.check).not.toHaveBeenCalled();
  });

  it('保留安全冲突码，隐藏未分类内部异常', async () => {
    const { app, service } = await fixture();
    service.start.mockRejectedValueOnce(new CliInstallationError('agent_busy'));
    const busy = await app.inject({
      method: 'POST',
      url: `${url}/operations`,
      headers,
      payload: { action: 'update', revision: state.revision },
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ code: 'agent_busy' });
    service.read.mockRejectedValueOnce(new Error('private-token'));
    const failed = await app.inject({ url, headers });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain('private-token');
  });
});
