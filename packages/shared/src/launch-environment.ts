import { z } from 'zod';
import type { AgentKind } from './agents';

export const LaunchVariableModeSchema = z.enum(['inherit', 'set', 'disabled']);
export const LaunchEnvironmentInputSchema = z.strictObject({
  revision: z.string().regex(/^(missing|[a-f0-9]{64})$/),
  variables: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(80),
        mode: LaunchVariableModeSchema,
        value: z
          .string()
          .min(1)
          .max(4096)
          .regex(/^[^\r\n\0]+$/)
          .optional(),
      }),
    )
    .max(16),
});
export type LaunchEnvironmentInput = z.infer<typeof LaunchEnvironmentInputSchema>;
export type LaunchVariableMode = z.infer<typeof LaunchVariableModeSchema>;
export type LaunchEnvironmentDocument = {
  agent: AgentKind;
  revision: string;
  encryptionAvailable: boolean;
  note: string;
  variables: Array<{
    name: string;
    label: string;
    sensitive: boolean;
    mode: LaunchVariableMode;
    source: 'inherited' | 'configured' | 'disabled' | 'unset';
    hasValue: boolean;
  }>;
};
