import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AgentKind, AgentProbe, EnvironmentReport, EnvironmentTool, ProbeStatus } from '@agentdeck/shared';
import { ProductSettingsInputSchema } from '@agentdeck/shared';
import { ProductSettingsError, type ProductSettingsStore } from '../settings/product-settings';
import { anonymousConfigError } from '../settings/errors';
import type { AgentProbes } from '../agents/probe';

const Empty = z.strictObject({});
const TOOL_NAMES: Record<AgentKind, EnvironmentTool['name']> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
const FALLBACK_MESSAGES: Record<ProbeStatus, string | null> = {
  available: null,
  missing: '未找到或无法启动可执行文件',
  changed: '接口可能已变化',
  'credential-missing': '启动环境缺少凭据',
};
/** 环境面板沿用旧结构，但数据只来自第一层探测，不再单独跑 git/rclone。 */
function environmentReport(probes: AgentProbe[]): EnvironmentReport {
  return {
    checkedAt: Date.now(),
    tools: probes.map((probe) => ({
      name: TOOL_NAMES[probe.agent],
      available: probe.status === 'available',
      version: probe.version ?? null,
      message: probe.message ?? FALLBACK_MESSAGES[probe.status],
    })),
  };
}
async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  reply.header('Cache-Control', 'no-store');
  try {
    return await operation();
  } catch (error) {
    const failure = error instanceof ProductSettingsError ? error : anonymousConfigError(error);
    return reply.code(failure.status).send({ code: failure.code, message: failure.message });
  }
}
export function registerProductSettingsRoutes(
  app: FastifyInstance,
  settings: ProductSettingsStore,
  probes: AgentProbes,
) {
  const readEnvironment = async () => environmentReport(await probes.probeAll());
  app.get('/api/settings/product', (request, reply) =>
    respond(reply, async () => {
      if (!Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '产品设置请求格式不正确');
      return settings.read();
    }),
  );
  app.put('/api/settings/product', { bodyLimit: 16384 }, (request, reply) =>
    respond(reply, async () => {
      const input = ProductSettingsInputSchema.safeParse(request.body);
      if (!input.success || !Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '请检查产品设置字段及数值范围');
      return settings.save(input.data);
    }),
  );
  app.get('/api/settings/environment', (request, reply) =>
    respond(reply, async () => {
      if (!Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '环境检测请求格式不正确');
      return readEnvironment();
    }),
  );
  app.post('/api/settings/environment', { bodyLimit: 1024 }, (request, reply) =>
    respond(reply, async () => {
      if (!Empty.safeParse(request.body).success || !Empty.safeParse(request.query).success)
        throw new ProductSettingsError('invalid_request', 400, '环境检测请求格式不正确');
      return readEnvironment();
    }),
  );
}
