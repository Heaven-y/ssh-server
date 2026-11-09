import { z } from 'zod';
import type { AgentEvent } from './events';

/** 原生子代理 ID 仅用作已枚举记录的标识，不接受路径。 */
export const SubagentIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const SubagentQuerySchema = z
  .object({
    agentId: SubagentIdSchema.optional(),
    cursor: z
      .string()
      .regex(/^\d{1,8}$/)
      .optional(),
  })
  .strict()
  .refine((query) => query.agentId !== undefined || query.cursor === undefined);
export type SubagentQuery = z.infer<typeof SubagentQuerySchema>;
export type SubagentHistory = {
  agentId: string;
  events: AgentEvent[];
  parentAgentId?: string;
  nextCursor?: string;
};
export type SubagentRead = { agentIds: string[] } | SubagentHistory;
