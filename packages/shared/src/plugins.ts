import { z } from 'zod';

export const WorkbenchPluginIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const WorkbenchPluginPermissionSchema = z.enum(['storage', 'project-context']);
export const WorkbenchPluginCommandSchema = z
  .object({
    id: WorkbenchPluginIdSchema,
    title: z.string().trim().min(1).max(80),
  })
  .strict();
export const WorkbenchPluginManifestSchema = z
  .object({
    id: WorkbenchPluginIdSchema,
    name: z.string().trim().min(1).max(80),
    version: z
      .string()
      .min(1)
      .max(64)
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
    apiVersion: z.literal(1),
    /** v1 入口为自包含 HTML；脚本/样式内联，图片使用 data URI。 */
    entry: z.string().min(1).max(240).endsWith('.html'),
    description: z.string().max(1000).optional(),
    permissions: z.array(WorkbenchPluginPermissionSchema).max(2).default([]),
    /** 命令用于打开插件页面，不执行后端代码或系统命令。 */
    commands: z.array(WorkbenchPluginCommandSchema).max(32).default([]),
  })
  .strict()
  .refine((manifest) => new Set(manifest.permissions).size === manifest.permissions.length)
  .refine((manifest) => new Set(manifest.commands.map((command) => command.id)).size === manifest.commands.length);

export type WorkbenchPluginManifest = z.infer<typeof WorkbenchPluginManifestSchema>;
export type WorkbenchPluginPermission = z.infer<typeof WorkbenchPluginPermissionSchema>;
export type WorkbenchPluginCommand = z.infer<typeof WorkbenchPluginCommandSchema>;
export type WorkbenchPlugin = {
  manifest: WorkbenchPluginManifest;
  builtin: boolean;
  enabled: boolean;
  installedAt?: number;
};
export type WorkbenchPluginCatalog = { plugins: WorkbenchPlugin[]; revision: string };
export type WorkbenchPluginInstallInput = { directory: string };
export type WorkbenchPluginUpdateInput = { enabled: boolean; revision: string };
export type WorkbenchPluginRemoveInput = { revision: string };
export type WorkbenchPluginPage = { html: string };
export type WorkbenchPluginStorage = { value: Record<string, z.infer<ReturnType<typeof z.json>>>; revision: string };
export type WorkbenchPluginStorageInput = WorkbenchPluginStorage;
