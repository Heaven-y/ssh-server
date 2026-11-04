import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import type { AgentKind, AgentProbe } from '@agentdeck/shared';
import { createProductSettings } from '../../src/settings/product-settings';
import { registerProductSettingsRoutes } from '../../src/http/product-settings.routes';

function probesStub(results: AgentProbe[]) {
  return {
    probe: vi.fn(async (agent: AgentKind) => results.find((result) => result.agent === agent)!),
    probeAll: vi.fn(async () => results),
  };
}

const CHANGED_CODEX =
  'codex 已安装（版本 0.166.0），但 app-server generate-json-schema 没有生成有效的 JSON；接口可能已变化。';

it('环境报告把 AgentProbe 映射成界面结构，不依赖旧的工具检测', async () => {
  const probes = probesStub([
    { agent: 'claude', status: 'available', version: '2.1.317' },
    {
      agent: 'codex',
      status: 'changed',
      version: '0.166.0',
      missing: ['generate-json-schema'],
      message: CHANGED_CODEX,
    },
    { agent: 'antigravity', status: 'missing', message: '可执行文件 agy 未找到或无法启动。' },
  ]);
  const app = Fastify();
  registerProductSettingsRoutes(app, createProductSettings({ configDir: 'unused-test-config' }), probes);
  try {
    const response = await app.inject({ url: '/api/settings/environment' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      checkedAt: expect.any(Number),
      tools: [
        { name: 'Claude Code', available: true, version: '2.1.317', message: null },
        { name: 'Codex', available: false, version: '0.166.0', message: CHANGED_CODEX },
        { name: 'Antigravity', available: false, version: null, message: '可执行文件 agy 未找到或无法启动。' },
      ],
    });
    expect(probes.probeAll).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

it('AgentProbe 没带说明时给出按状态区分的兜底文案', async () => {
  const probes = probesStub([{ agent: 'codex', status: 'changed', missing: ['turn/interrupt'] }]);
  const app = Fastify();
  registerProductSettingsRoutes(app, createProductSettings({ configDir: 'unused-test-config' }), probes);
  try {
    const report = (await app.inject({ url: '/api/settings/environment' })).json();
    expect(report.tools).toEqual([{ name: 'Codex', available: false, version: null, message: '接口可能已变化' }]);
  } finally {
    await app.close();
  }
});

it('GET 与 POST 都实时探测，非法参数不触发额外进程', async () => {
  const probes = probesStub([{ agent: 'claude', status: 'available', version: '2.1.317' }]);
  const app = Fastify();
  registerProductSettingsRoutes(app, createProductSettings({ configDir: 'unused-test-config' }), probes);
  try {
    await app.inject({ url: '/api/settings/environment' });
    await app.inject({ url: '/api/settings/environment' });
    const refresh = await app.inject({ method: 'POST', url: '/api/settings/environment', payload: {} });
    expect(refresh.statusCode).toBe(200);
    expect(probes.probeAll).toHaveBeenCalledTimes(3);
    expect((await app.inject({ url: '/api/settings/environment?path=x' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/settings/environment', payload: { install: true } })).statusCode,
    ).toBe(400);
    expect(probes.probeAll).toHaveBeenCalledTimes(3);
  } finally {
    await app.close();
  }
});
