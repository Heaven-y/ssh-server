import { z } from 'zod';

export const DEFAULT_EXCLUDED_EXTENSIONS = [
  'pkl',
  'pickle',
  'pt',
  'pth',
  'ckpt',
  'safetensors',
  'joblib',
  'npy',
  'npz',
  'rdata',
  'rds',
  'h5',
  'hdf5',
  'parquet',
  'arrow',
  'zip',
  'gz',
  'bz2',
  'xz',
  'tar',
  '7z',
  'rar',
];
export const SyncSettingsSchema = z.object({
  maxFileBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  excludedExtensions: z
    .array(z.string().regex(/^[a-zA-Z0-9]{1,20}$/))
    .max(100)
    .default(DEFAULT_EXCLUDED_EXTENSIONS)
    .transform((items) => [...new Set(items.map((item) => item.toLowerCase()))].sort()),
});
export type SyncSettings = z.infer<typeof SyncSettingsSchema>;
export type SyncConflict = { path: string; localCopy: string; remoteCopy: string };
export type SyncStatus = {
  phase: 'uninitialized' | 'syncing' | 'ready' | 'confirmation_required' | 'conflicts' | 'error';
  reason?: 'initialization' | 'deletions' | 'recovery' | 'filter_changed';
  message?: string;
  lastSuccessAt?: number;
  deletions: string[];
  conflicts: SyncConflict[];
  settings: SyncSettings;
};
