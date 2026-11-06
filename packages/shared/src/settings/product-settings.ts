import { z } from 'zod';
import { AgentKindSchema } from '../conversation/agents';

export const ProductSettingsSchema = z.strictObject({
  defaultAgent: AgentKindSchema.default('claude'),
  resources: z
    .strictObject({
      intervalSeconds: z.number().int().min(2).max(60).default(5),
      timeoutSeconds: z.number().int().min(2).max(30).default(8),
    })
    .default({ intervalSeconds: 5, timeoutSeconds: 8 }),
});
export type ProductSettings = z.infer<typeof ProductSettingsSchema>;
export type ProductSettingsDocument = { settings: ProductSettings; revision: string };
export const ProductSettingsInputSchema = z.strictObject({
  settings: ProductSettingsSchema,
  revision: z.string().regex(/^(missing|[a-f0-9]{64})$/),
});
export type ProductSettingsInput = z.infer<typeof ProductSettingsInputSchema>;
export const resourceTiming = (settings: ProductSettings['resources']) => ({
  intervalMs: settings.intervalSeconds * 1000,
  timeoutMs: settings.timeoutSeconds * 1000,
  staleMs: Math.max(15000, settings.intervalSeconds * 3000),
});
export type ResourceTiming = ReturnType<typeof resourceTiming>;
/** 环境面板只显示三个 Agent 的第一层探测结果；同步与本地 git 域删除后不再检测 git/rclone。 */
export type EnvironmentTool = {
  name: 'Claude Code' | 'Codex' | 'Antigravity';
  available: boolean;
  version: string | null;
  message: string | null;
};
export type EnvironmentReport = { checkedAt: number; tools: EnvironmentTool[] };
