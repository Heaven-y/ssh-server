import {
  SyncSettingsSchema,
  type WorkspaceInput,
  type SetupInventory,
  type WorkspaceSetupPreview,
} from '@ssh-server/shared';
import type { SshPool } from '../../ssh/pool';
import { eligibleFile } from '../../sync/filters';
import { localInventory, type FileEntry } from '../../sync/inventory';
import { readRcloneMetadata } from '../../sync/rclone';
import { inspectLocalRoot } from './local';

function summarize(files: FileEntry[], settings: ReturnType<typeof SyncSettingsSchema.parse>): SetupInventory {
  const result: SetupInventory = { included: { files: 0, bytes: 0 }, excluded: { files: 0, bytes: 0, examples: [] } };
  for (const file of files) {
    const included = eligibleFile(file.path, file.size, settings);
    const bucket = included ? result.included : result.excluded;
    bucket.files++;
    bucket.bytes += file.size;
    if (!included && result.excluded.examples.length < 20) result.excluded.examples.push(file.path);
  }
  return result;
}
export async function previewWorkspace(
  deps: { configDir: string; pool: SshPool; remoteMetadata?: typeof readRcloneMetadata },
  input: WorkspaceInput,
  signal: AbortSignal,
): Promise<WorkspaceSetupPreview> {
  const settings = SyncSettingsSchema.parse(input.sync ?? {});
  const local = await inspectLocalRoot(input.localDir, signal);
  const [localFiles, remoteFiles] = await Promise.all([
    localInventory(local.info.path, settings, { signal, maxEntries: 20000 }),
    (deps.remoteMetadata ?? readRcloneMetadata)(
      deps,
      { ...input, localDir: local.info.path, id: 'setup-preview' },
      signal,
    ),
  ]);
  signal.throwIfAborted();
  return {
    local: summarize(localFiles.all, settings),
    remote: summarize(remoteFiles, settings),
    sampledAt: Date.now(),
  };
}
