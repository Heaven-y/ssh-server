import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCapabilitiesService } from '../../src/chat/capabilities';
import { registerCapabilityRoutes } from '../../src/http/capabilities.routes';
import { SessionError } from '../../src/chat/sessions';

describe('能力目录路由', () => {
  it('限定工作区与Agent、禁止缓存，并对原生失败返回匿名错误', async () => {
    const ws = {
      id: 'workspace',
      name: 'demo',
      dir: path.join(tmpdir(), 'capabilities-route'),
      server: 'my-server',
      remoteDir: '~/projects/demo',
    };
    const provider = vi.fn(async () => ({ models: [], entries: [], warnings: ['模型目录暂不可用'] }));
    const app = Fastify();
    registerCapabilityRoutes(app, {
      store: { get: async (id) => (id === ws.id ? ws : undefined) },
      capabilities: createCapabilitiesService({ claude: provider, codex: provider }),
      sessions: { assertBelongs: async () => ws },
    });
    try {
      expect((await app.inject('/api/workspaces/workspace/agent-capabilities?agent=other')).statusCode).toBe(400);
      expect((await app.inject('/api/workspaces/missing/agent-capabilities?agent=claude')).statusCode).toBe(404);
      const empty = await app.inject('/api/workspaces/workspace/agent-capabilities?agent=codex');
      expect(empty.json().entries).toEqual([]);
      expect(provider).not.toHaveBeenCalled();
      const refresh = await app.inject({
        method: 'POST',
        url: '/api/workspaces/workspace/agent-capabilities?agent=codex',
      });
      expect(refresh.statusCode).toBe(200);
      const result = await app.inject('/api/workspaces/workspace/agent-capabilities?agent=codex');
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.json()).toEqual({ agent: 'codex', models: [], entries: [], warnings: ['模型目录暂不可用'] });
      expect(provider).toHaveBeenCalledWith(ws.dir, expect.any(AbortSignal));
      expect(provider).toHaveBeenCalledTimes(1);
      provider.mockRejectedValueOnce(new Error('private-config-sentinel'));
      const failed = await app.inject({
        method: 'POST',
        url: '/api/workspaces/workspace/agent-capabilities?agent=claude',
      });
      expect(failed.statusCode).toBe(503);
      expect(failed.body).not.toContain('private-config-sentinel');
    } finally {
      await app.close();
    }
  });

  it('已有会话按核实的原生子目录刷新能力，跨项目身份在发现前被拒绝', async () => {
    const project = { id: 'project', name: '父项目', dir: path.join(tmpdir(), 'capabilities-scope') };
    const native = { ...project, dir: path.join(project.dir, 'child') };
    const provider = vi.fn(async () => ({ models: [], entries: [], warnings: ['子目录能力'] }));
    const scopes = { assertBelongs: vi.fn(async () => native) };
    const capabilities = createCapabilitiesService({ claude: provider });
    const app = Fastify();
    registerCapabilityRoutes(app, { store: { get: async () => project }, capabilities, sessions: scopes });
    const url = '/api/workspaces/project/agent-capabilities?agent=claude&sessionId=native';
    try {
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(200);
      expect(scopes.assertBelongs).toHaveBeenCalledWith(project, 'claude', 'native', expect.any(AbortSignal));
      expect(provider).toHaveBeenCalledExactlyOnceWith(native.dir, expect.any(AbortSignal));
      expect((await app.inject(url)).json().warnings).toEqual(['子目录能力']);
      expect((await capabilities.read(project, 'claude')).warnings).not.toEqual(['子目录能力']);
      scopes.assertBelongs.mockRejectedValueOnce(new SessionError(404, 'session_missing', '错误归属'));
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(404);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
