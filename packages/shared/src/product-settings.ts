import { z } from 'zod';
import { AgentKindSchema } from './agents';
import { SyncSettingsSchema } from './sync';

const model = z
  .string()
  .trim()
  .max(200)
  .regex(/^[^\r\n\0]*$/)
  .default('');
export const ProductSettingsSchema = z.strictObject({
  defaultAgent: AgentKindSchema.default('claude'),
  defaultModels: z.strictObject({ claude: model, codex: model }).default({ claude: '', codex: '' }),
  syncDefaults: SyncSettingsSchema.strict().default(() => SyncSettingsSchema.parse({})),
  syncIntervalSeconds: z.number().int().min(5).max(300).default(15),
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
export type EnvironmentTool = {
  name: 'Node.js' | 'Claude Code' | 'Codex' | 'git' | 'rclone';
  available: boolean;
  version: string | null;
  message: string | null;
};
export type EnvironmentReport = { checkedAt: number; tools: EnvironmentTool[] };
