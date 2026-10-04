import { z } from 'zod';
import { WorkspaceInputSchema, type Workspace } from './workspace';
import type { SyncStatus } from './sync';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);
export const ManualServerInputSchema = z
  .object({
    name: text(100),
    hostname: text(255)
      .transform((value) => value.replace(/^\[(.*)\]$/, '$1').toLowerCase())
      .refine((value) => /^[a-z0-9._:-]+$/i.test(value) && !value.startsWith('-'), '服务器地址格式不合法'),
    port: z.number().int().min(1).max(65535).default(22),
    username: text(128).refine((value) => !/\s/.test(value), '账号不能包含空白字符'),
    keyFile: text(4096).optional(),
  })
  .strict();
export type ManualServerInput = z.infer<typeof ManualServerInputSchema>;
export type ManagedServer = ManualServerInput & { alias: string };
export const ManagedServerSchema = ManualServerInputSchema.extend({
  alias: z.string().regex(/^managed-ssh-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
});

export type HostTrustStatus = {
  status: 'trusted' | 'unknown';
  alias: string;
  target: { hostname: string; port: number; username: string };
  algorithm: string;
  fingerprint: string;
  challenge?: string;
  expiresAt?: number;
};
export const HostTrustConfirmationSchema = z
  .object({
    challenge: z.string().uuid(),
    fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    confirmed: z.literal(true),
  })
  .strict();
export type HostTrustConfirmation = z.infer<typeof HostTrustConfirmationSchema>;

export const WorkspaceSetupInputSchema = WorkspaceInputSchema.extend({
  localDir: z.string().min(1).max(4096),
  sshHost: z.string().min(1).max(200),
  remoteDir: WorkspaceInputSchema.shape.remoteDir.max(4096),
}).strict();
export const WorkspaceSetupCreateSchema = z
  .object({
    input: WorkspaceSetupInputSchema,
    verification: z.string().uuid(),
    initializationConfirmed: z.literal(true),
  })
  .strict();
export type WorkspaceSetupCreate = z.infer<typeof WorkspaceSetupCreateSchema>;
export type LocalDirectory = {
  path: string;
  parent: string;
  roots: string[];
  entries: Array<{ name: string; path: string; type: 'directory' | 'file' | 'link' | 'other' }>;
  nextCursor?: string;
};
export type SetupDirectoryInfo = { path: string; empty: boolean; git: boolean };
export type WorkspaceSetupVerification = {
  verification: string;
  expiresAt: number;
  local: SetupDirectoryInfo;
  remote: SetupDirectoryInfo;
  target: { sshHost: string; authMode: 'key' | 'password' };
};
export type SetupInventory = {
  included: { files: number; bytes: number };
  excluded: { files: number; bytes: number; examples: string[] };
};
export type WorkspaceSetupPreview = { local: SetupInventory; remote: SetupInventory; sampledAt: number };
export type WorkspaceSetupResult = { workspace: Workspace; sync: SyncStatus };
