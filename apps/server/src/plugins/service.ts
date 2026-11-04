import path from 'node:path';
import type {
  WorkbenchPluginCatalog,
  WorkbenchPluginInstallInput,
  WorkbenchPluginPage,
  WorkbenchPluginRemoveInput,
  WorkbenchPluginStorage,
  WorkbenchPluginStorageInput,
  WorkbenchPluginUpdateInput,
} from '@agentdeck/shared';
import { contentRevision, decodeUtf8 } from '../settings/safe-file';
import { WorkbenchPluginError, pluginError } from './errors';
import { childPath, readPluginFile, removePluginDirectory } from './files';
import { copyPluginPackage, readPluginPackage } from './package';
import { createPluginRegistry, registryCatalog, type RegistrySnapshot } from './registry';
import { createPluginStorage } from './storage';

type Deps = { configDir: string; onDisable?: (id: string) => Promise<void> | void };
function assertRevision(current: RegistrySnapshot, revision: string) {
  if (current.snapshot.revision !== revision) throw new WorkbenchPluginError('revision_conflict');
}
function findPlugin(current: RegistrySnapshot, id: string) {
  const plugin = registryCatalog(current).plugins.find((entry) => entry.manifest.id === id);
  if (!plugin) throw new WorkbenchPluginError('plugin_missing');
  return plugin;
}
function activePlugin(current: RegistrySnapshot, id: string) {
  const plugin = findPlugin(current, id);
  if (!plugin.enabled) throw new WorkbenchPluginError('plugin_disabled');
  return plugin;
}

export function createWorkbenchPlugins(deps: Deps) {
  const directory = path.resolve(deps.configDir, 'workbench-plugins');
  const packages = path.join(directory, 'packages');
  const registry = createPluginRegistry(directory);
  const storage = createPluginStorage(path.join(directory, 'storage'));
  let enabledIds = new Set<string>();
  const suspended = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();
  function publish(current: RegistrySnapshot): WorkbenchPluginCatalog {
    const catalog = registryCatalog(current);
    enabledIds = new Set(catalog.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.manifest.id));
    return catalog;
  }
  async function suspending<T>(id: string, operation: () => Promise<T>): Promise<T> {
    suspended.add(id);
    try {
      return await operation();
    } finally {
      // 清理或写盘失败后以磁盘事实恢复；状态不可读取时保守禁用。
      try {
        publish(await registry.load());
      } catch {
        enabledIds.clear();
      }
      suspended.delete(id);
    }
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      throw pluginError(error);
    });
  }
  async function cleanup(id: string) {
    try {
      await deps.onDisable?.(id);
    } catch {
      throw new WorkbenchPluginError('cleanup_failed');
    }
  }
  async function withStorage(id: string) {
    const plugin = activePlugin(await registry.load(), id);
    if (!plugin.manifest.permissions.includes('storage')) throw new WorkbenchPluginError('permission_denied');
  }
  return {
    isEnabled(id: string): boolean {
      return enabledIds.has(id) && !suspended.has(id);
    },
    list(): Promise<WorkbenchPluginCatalog> {
      return serial(async () => publish(await registry.load()));
    },
    install(input: WorkbenchPluginInstallInput): Promise<WorkbenchPluginCatalog> {
      return serial(async () => {
        const current = await registry.load();
        const source = await readPluginPackage(input.directory);
        if (
          source.manifest.id === 'ssh-console' ||
          current.state.plugins.some((entry) => entry.manifest.id === source.manifest.id)
        )
          throw new WorkbenchPluginError('already_installed');
        if (current.state.plugins.length >= 64) throw new WorkbenchPluginError('too_large');
        const target = childPath(packages, source.manifest.id);
        const identity = await copyPluginPackage(target, source);
        current.state.plugins.push({
          manifest: source.manifest,
          enabled: false,
          installedAt: Date.now(),
          entryRevision: contentRevision(source.files.get(source.manifest.entry)!),
        });
        try {
          return publish(await registry.save(current.state, current.snapshot));
        } catch (error) {
          await removePluginDirectory(target, identity);
          throw error;
        }
      });
    },
    update(id: string, input: WorkbenchPluginUpdateInput): Promise<WorkbenchPluginCatalog> {
      return serial(() =>
        suspending(id, async () => {
          const current = await registry.load();
          assertRevision(current, input.revision);
          const plugin = findPlugin(current, id);
          if (plugin.enabled === input.enabled) return publish(current);
          if (!input.enabled) await cleanup(id);
          if (plugin.builtin) current.state.sshConsoleEnabled = input.enabled;
          else current.state.plugins.find((entry) => entry.manifest.id === id)!.enabled = input.enabled;
          return publish(await registry.save(current.state, current.snapshot));
        }),
      );
    },
    remove(id: string, input: WorkbenchPluginRemoveInput): Promise<WorkbenchPluginCatalog> {
      return serial(() =>
        suspending(id, async () => {
          let current = await registry.load();
          assertRevision(current, input.revision);
          const plugin = findPlugin(current, id);
          if (plugin.builtin) throw new WorkbenchPluginError('builtin_plugin');
          await cleanup(id);
          // 先持久停用；之后的文件清理失败时，插件保留可重试的停用记录。
          current.state.plugins.find((entry) => entry.manifest.id === id)!.enabled = false;
          current = await registry.save(current.state, current.snapshot);
          await removePluginDirectory(childPath(packages, id));
          await storage.remove(id);
          current.state.plugins = current.state.plugins.filter((entry) => entry.manifest.id !== id);
          return publish(await registry.save(current.state, current.snapshot));
        }),
      );
    },
    page(id: string): Promise<WorkbenchPluginPage> {
      return serial(async () => {
        const current = await registry.load();
        const plugin = activePlugin(current, id);
        if (plugin.builtin) throw new WorkbenchPluginError('builtin_plugin');
        const file = childPath(childPath(packages, id), plugin.manifest.entry);
        const bytes = await readPluginFile(file);
        const installed = current.state.plugins.find((entry) => entry.manifest.id === id)!;
        if (contentRevision(bytes) !== installed.entryRevision) throw new WorkbenchPluginError('unsafe_path');
        return { html: decodeUtf8(bytes) };
      });
    },
    readStorage(id: string): Promise<WorkbenchPluginStorage> {
      return serial(async () => {
        await withStorage(id);
        return storage.read(id);
      });
    },
    saveStorage(id: string, input: WorkbenchPluginStorageInput): Promise<WorkbenchPluginStorage> {
      return serial(async () => {
        await withStorage(id);
        return storage.save(id, input);
      });
    },
  };
}
export type WorkbenchPluginsService = ReturnType<typeof createWorkbenchPlugins>;
