import { z } from 'zod';
import { AgentKindSchema } from '../conversation/agents';

export const SessionToolsStatusSchema = z.strictObject({
  agent: AgentKindSchema,
  enabled: z.boolean(),
  available: z.boolean(),
  revision: z.string().min(1).max(256),
  message: z.string().optional(),
});
export const SessionToolsInputSchema = z.strictObject({
  enabled: z.boolean(),
  revision: z.string().min(1).max(256),
});
export type SessionToolsStatus = z.infer<typeof SessionToolsStatusSchema>;
export type SessionToolsInput = z.infer<typeof SessionToolsInputSchema>;
