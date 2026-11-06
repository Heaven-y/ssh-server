import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { WorkbenchPluginStorage, WorkbenchPluginStorageInput } from '@agentdeck/shared/plugins';
import {
  assertDirectoryUnchanged,
  inspectDirectory,
  readConfigFile,
  writeConfigFile,
} from '../platform/files/safe-file';
import { childPath, MAX_PLUGIN_STORAGE_BYTES, statIfPresent } from './files';
import { WorkbenchPluginError } from './errors';

export const PluginStorageValueSchema = z.record(z.string(), z.json());

export function createPluginStorage(directory: string) {
  const fileOf = (id: string) => childPath(directory, `${id}.json`);
  async function read(id: string) {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(fileOf(id)) : { content: '', revision: 'missing' };
    if (parents) await assertDirectoryUnchanged(parents);
    if (Buffer.byteLength(snapshot.content, 'utf8') > MAX_PLUGIN_STORAGE_BYTES)
      throw new WorkbenchPluginError('too_large');
    let value: WorkbenchPluginStorage['value'];
    try {
      value = snapshot.revision === 'missing' ? {} : PluginStorageValueSchema.parse(JSON.parse(snapshot.content));
    } catch {
      throw new WorkbenchPluginError('registry_invalid');
    }
    return { snapshot, document: { value, revision: snapshot.revision } };
  }
  return {
    async read(id: string): Promise<WorkbenchPluginStorage> {
      return (await read(id)).document;
    },
    async save(id: string, input: WorkbenchPluginStorageInput): Promise<WorkbenchPluginStorage> {
      const parsed = PluginStorageValueSchema.safeParse(input.value);
      if (!parsed.success) throw new WorkbenchPluginError('invalid_request');
      const bytes = Buffer.from(JSON.stringify(parsed.data) + '\n', 'utf8');
      if (bytes.length > MAX_PLUGIN_STORAGE_BYTES) throw new WorkbenchPluginError('too_large');
      const current = await read(id);
      if (current.snapshot.revision !== input.revision) throw new WorkbenchPluginError('revision_conflict');
      const parents = await inspectDirectory(directory, true);
      await writeConfigFile(fileOf(id), bytes, current.snapshot, parents!);
      return (await read(id)).document;
    },
    async remove(id: string) {
      const parents = await inspectDirectory(directory);
      if (!parents) return;
      const file = fileOf(id);
      const stat = await statIfPresent(file);
      if (!stat) return;
      if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkbenchPluginError('unsafe_path');
      await assertDirectoryUnchanged(parents);
      await unlink(file);
    },
  };
}
