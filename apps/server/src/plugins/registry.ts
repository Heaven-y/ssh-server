import path from 'node:path';
import { z } from 'zod';
import {
  WorkbenchPluginManifestSchema,
  type WorkbenchPlugin,
  type WorkbenchPluginCatalog,
  type WorkbenchPluginManifest,
} from '@agentdeck/shared';
import {
  assertDirectoryUnchanged,
  inspectDirectory,
  MAX_CONFIG_BYTES,
  readConfigFile,
  writeConfigFile,
} from '../settings/safe-file';
import { WorkbenchPluginError } from './errors';
import { safeRelative } from './files';

export const SSH_CONSOLE_MANIFEST: WorkbenchPluginManifest = {
  id: 'ssh-console',
  name: 'SSH Console',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.html',
  description: '内置服务器控制台，提供独立服务器页面、资源、文件和终端。',
  permissions: [],
  commands: [{ id: 'open', title: '打开 SSH Console' }],
};
const InstalledPluginSchema = z
  .object({
    manifest: WorkbenchPluginManifestSchema,
    enabled: z.boolean(),
    installedAt: z.number().int().nonnegative(),
    entryRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const RegistrySchema = z
  .object({
    version: z.literal(1),
    sshConsoleEnabled: z.boolean(),
    plugins: z.array(InstalledPluginSchema).max(64),
  })
  .strict()
  .refine((registry) => {
    const ids = registry.plugins.map((plugin) => plugin.manifest.id);
    return (
      !ids.includes('ssh-console') &&
      new Set(ids).size === ids.length &&
      registry.plugins.every((plugin) => safeRelative(plugin.manifest.id) && safeRelative(plugin.manifest.entry))
    );
  });
export type PluginRegistry = z.infer<typeof RegistrySchema>;
export type InstalledPlugin = z.infer<typeof InstalledPluginSchema>;
export type RegistrySnapshot = Awaited<ReturnType<ReturnType<typeof createPluginRegistry>['load']>>;

export function publicPlugin(plugin: InstalledPlugin): WorkbenchPlugin {
  return { manifest: plugin.manifest, enabled: plugin.enabled, installedAt: plugin.installedAt, builtin: false };
}
export function registryCatalog(current: RegistrySnapshot): WorkbenchPluginCatalog {
  return {
    revision: current.snapshot.revision,
    plugins: [
      { manifest: structuredClone(SSH_CONSOLE_MANIFEST), builtin: true, enabled: current.state.sshConsoleEnabled },
      ...current.state.plugins.map(publicPlugin),
    ],
  };
}

export function createPluginRegistry(directory: string) {
  const file = path.join(directory, 'registry.json');
  async function load() {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    if (parents) await assertDirectoryUnchanged(parents);
    let state: PluginRegistry;
    try {
      state =
        snapshot.revision === 'missing'
          ? { version: 1, sshConsoleEnabled: true, plugins: [] }
          : RegistrySchema.parse(JSON.parse(snapshot.content));
    } catch {
      throw new WorkbenchPluginError('registry_invalid');
    }
    return { state, snapshot };
  }
  return {
    load,
    async save(state: PluginRegistry, previous: Awaited<ReturnType<typeof load>>['snapshot']) {
      const bytes = Buffer.from(JSON.stringify(state, null, 2) + '\n', 'utf8');
      if (bytes.length > MAX_CONFIG_BYTES) throw new WorkbenchPluginError('too_large');
      const parents = await inspectDirectory(directory, true);
      await writeConfigFile(file, bytes, previous, parents!);
      return load();
    },
  };
}
