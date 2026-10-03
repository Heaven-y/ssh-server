import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCapabilitiesService } from '../../src/chat/capabilities';
import { registerCapabilityRoutes } from '../../src/http/capabilities.routes';

describe('能力目录路由', () => {
  it('限定工作区与Agent、禁止缓存，并对原生失败返回匿名错误', async () => {
    const ws = {
      id: 'workspace',
      name: 'demo',
      localDir: path.join(tmpdir(), 'capabilities-route'),
      sshHost: 'my-server',
      remoteDir: '~/projects/demo',
    };
    const provider = vi.fn(async () => ({ models: [], entries: [], warnings: ['模型目录暂不可用'] }));
    const app = Fastify();
    registerCapabilityRoutes(app, {
      store: { get: async (id) => (id === ws.id ? ws : undefined) },
      capabilities: createCapabilitiesService({ claude: provider, codex: provider }),
    });
    try {
      expect((await app.inject('/api/workspaces/workspace/agent-capabilities?agent=other')).statusCode).toBe(400);
      expect((await app.inject('/api/workspaces/missing/agent-capabilities?agent=claude')).statusCode).toBe(404);
      const result = await app.inject('/api/workspaces/workspace/agent-capabilities?agent=codex');
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.json()).toEqual({ agent: 'codex', models: [], entries: [], warnings: ['模型目录暂不可用'] });
      expect(provider).toHaveBeenCalledWith(ws.localDir, expect.any(AbortSignal));
      provider.mockRejectedValueOnce(new Error('private-config-sentinel'));
      const failed = await app.inject('/api/workspaces/workspace/agent-capabilities?agent=claude');
      expect(failed.statusCode).toBe(503);
      expect(failed.body).not.toContain('private-config-sentinel');
    } finally {
      await app.close();
    }
  });
});
