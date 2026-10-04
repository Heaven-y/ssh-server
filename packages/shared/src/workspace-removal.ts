import { z } from 'zod';
import type { Workspace } from './workspace';

export const WorkspaceRemovalInputSchema = z
  .object({
    configuration: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict();
export type WorkspaceRemovalInput = z.infer<typeof WorkspaceRemovalInputSchema>;
export type WorkspaceRemovalBlocker = { code: string; message: string };
export type WorkspaceRemovalPreview = {
  workspace: Workspace;
  configuration: string;
  blockers: WorkspaceRemovalBlocker[];
};
export type WorkspaceRemovalResult = { removed: true; cleanupWarning?: string };
