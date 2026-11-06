import type { BuiltinPluginDefinition } from './contracts';
import path from 'node:path';
import { z } from 'zod';
import {
  WorkbenchPluginManifestSchema,
  type WorkbenchPlugin,
  type WorkbenchPluginCatalog,
} from '@agentdeck/shared/plugins';
import {
  assertDirectoryUnchanged,
  inspectDirectory,
  MAX_CONFIG_BYTES,
  readConfigFile,
  writeConfigFile,
} from '../platform/files/safe-file';
import { WorkbenchPluginError } from './errors';
import { safeRelative } from './files';

const InstalledPluginSchema = z
  .object({
    manifest: WorkbenchPluginManifestSchema,
    enabled: z.boolean(),
    installedAt: z.number().int().nonnegative(),
    entryRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const LegacyRegistrySchema = z.strictObject({
  version: z.literal(1),
  sshConsoleEnabled: z.boolean(),
  plugins: z.array(InstalledPluginSchema).max(64),
});
const RegistrySchema = z.strictObject({
  version: z.literal(2),
  builtinEnabled: z.record(z.string(), z.boolean()),
  plugins: z.array(InstalledPluginSchema).max(64),
});
function parseRegistry(value: unknown, builtins: BuiltinPluginDefinition[]) {
  const legacy = LegacyRegistrySchema.safeParse(value);
  const state = legacy.success
    ? {
        version: 2 as const,
        builtinEnabled: { 'ssh-console': legacy.data.sshConsoleEnabled },
        plugins: legacy.data.plugins,
      }
    : RegistrySchema.parse(value);
  const ids = state.plugins.map((plugin) => plugin.manifest.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => builtins.some((entry) => entry.manifest.id === id)) ||
    !state.plugins.every((plugin) => safeRelative(plugin.manifest.id) && safeRelative(plugin.manifest.entry))
  )
    throw new WorkbenchPluginError('registry_invalid');
  return state;
}
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
      ...current.builtins.map(({ manifest, defaultEnabled }) => ({
        manifest: structuredClone(manifest),
        builtin: true,
        enabled: current.state.builtinEnabled[manifest.id] ?? defaultEnabled,
      })),
      ...current.state.plugins.map(publicPlugin),
    ],
  };
}

export function createPluginRegistry(directory: string, builtins: BuiltinPluginDefinition[]) {
  const file = path.join(directory, 'registry.json');
  async function load() {
    const parents = await inspectDirectory(directory);
    const snapshot = parents ? await readConfigFile(file) : { content: '', revision: 'missing' };
    if (parents) await assertDirectoryUnchanged(parents);
    let state: PluginRegistry;
    try {
      state =
        snapshot.revision === 'missing'
          ? { version: 2, builtinEnabled: {}, plugins: [] }
          : parseRegistry(JSON.parse(snapshot.content), builtins);
    } catch {
      throw new WorkbenchPluginError('registry_invalid');
    }
    return { state, snapshot, builtins };
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
