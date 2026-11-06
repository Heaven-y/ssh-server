// Agent 探测接口：每次请求都会真实启动子进程跑 --version/--help（Codex 还有 schema 生成），
// 没有缓存；所以必须逐次声明 no-store，否则浏览器或代理会把旧结果当成当前状态。
// 这里只返回第一层结果，不触发能力目录，也不向模型端点发请求。
import type { FastifyInstance } from 'fastify';
import type { AgentProbes } from '../agents/common/probe';

export type ProbeRoutesDeps = {
  probes: Pick<AgentProbes, 'probeAll'>;
};

export function registerProbeRoutes(app: FastifyInstance, deps: ProbeRoutesDeps): void {
  app.get('/api/agents/probes', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return deps.probes.probeAll();
  });
}
