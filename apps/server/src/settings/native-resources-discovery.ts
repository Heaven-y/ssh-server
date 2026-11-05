import type { Dirent } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import type { NativeResource, NativeResourceRoot } from '@agentdeck/shared';
import {
  makeResourceTarget,
  resourcePathKey,
  type ResourceContext,
  type ResourcePlan,
  type ResourceRoot,
  type ResourceScan,
  type ResourceTarget,
} from './native-resources-catalog';
import { NativeResourceError, resourceError } from './native-resources-errors';
import { assertDirectoryUnchanged, inspectDirectory, MAX_CONFIG_BYTES } from './safe-file';

const MAX_DISCOVERY_ENTRIES = 4096;
const MAX_DIRECTORY_DEPTH = 6;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'out',
  'build',
  'target',
  'coverage',
  '__pycache__',
]);

async function optionalStat(file: string) {
  return lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
}

export async function describeResource(target: ResourceTarget): Promise<NativeResource> {
  const { file, ...metadata } = target;
  try {
    const parents = await inspectDirectory(path.dirname(file));
    const stat = parents ? await optionalStat(file) : undefined;
    if (parents) await assertDirectoryUnchanged(parents);
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new NativeResourceError('unsafe_path');
    if (stat && stat.size > MAX_CONFIG_BYTES) throw new NativeResourceError('too_large');
    return { ...metadata, exists: !!stat, editable: true };
  } catch (error) {
    return { ...metadata, exists: false, editable: false, unavailableReason: resourceError(error).message };
  }
}

export async function describeRoot(root: ResourceRoot): Promise<NativeResourceRoot> {
  const { directory, ...metadata } = root;
  try {
    const parents = await inspectDirectory(directory);
    if (parents) await assertDirectoryUnchanged(parents);
    return { ...metadata, editable: true };
  } catch (error) {
    return { ...metadata, editable: false, unavailableReason: resourceError(error).message };
  }
}

export async function discoverResources(context: ResourceContext, plan: ResourcePlan) {
  const targets = new Map(plan.targets.map((target) => [resourcePathKey(target.file), target]));
  const warnings = new Set<string>();
  let remaining = MAX_DISCOVERY_ENTRIES;

  async function eachEntry(directory: string, visit: (entry: Dirent) => Promise<void>) {
    try {
      const parents = await inspectDirectory(directory);
      if (!parents) return;
      const handle = await opendir(directory);
      for await (const entry of handle) {
        if (--remaining < 0) {
          warnings.add('目录内容较多，已达到本次扫描上限；可使用原生 CLI 查看其他资源。');
          break;
        }
        if (entry.isSymbolicLink()) {
          warnings.add('目录中存在链接资源，未跟随链接读取；请使用原生 CLI 管理这些资源。');
          continue;
        }
        await visit(entry);
      }
      await assertDirectoryUnchanged(parents);
    } catch {
      warnings.add('部分原生目录无法安全读取，已跳过；请检查文件权限或链接。');
    }
  }

  async function addExisting(base: ResourceScan, relative: string, kind: NativeResource['kind']) {
    const target = makeResourceTarget(context.agent, base, relative, { kind });
    if (await optionalStat(target.file)) targets.set(resourcePathKey(target.file), target);
  }

  async function ruleFiles(scan: ResourceScan, relative = '', depth = 0): Promise<void> {
    await eachEntry(path.join(scan.directory, relative), async (entry) => {
      const name = path.join(relative, entry.name);
      const suffix = scan.mode === 'policy' ? '.rules' : '.md';
      if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) await addExisting(scan, name, 'rules');
      if (!entry.isDirectory() || scan.mode === 'policy') return;
      if (depth < MAX_DIRECTORY_DEPTH) await ruleFiles(scan, name, depth + 1);
      else warnings.add('部分规则目录层级较深，已达到本次扫描上限。');
    });
  }

  async function skillFiles(scan: ResourceScan) {
    await eachEntry(scan.directory, async (entry) => {
      if (entry.isDirectory()) await addExisting(scan, path.join(entry.name, 'SKILL.md'), 'skills');
    });
  }

  async function pluginFiles(scan: ResourceScan) {
    await eachEntry(scan.directory, async (entry) => {
      if (!entry.isDirectory()) return;
      const base: ResourceScan = {
        ...scan,
        directory: path.join(scan.directory, entry.name),
        displayPath: path.posix.join(scan.displayPath, entry.name),
      };
      for (const [name, kind] of [
        ['plugin.json', 'plugins'],
        ['mcp_config.json', 'mcp'],
        ['hooks.json', 'hooks'],
      ] as const)
        await addExisting(base, name, kind);
      await ruleFiles({
        ...base,
        mode: 'rules',
        directory: path.join(base.directory, 'rules'),
        displayPath: `${base.displayPath}/rules`,
      });
      await skillFiles({
        ...base,
        mode: 'skills',
        directory: path.join(base.directory, 'skills'),
        displayPath: `${base.displayPath}/skills`,
      });
    });
  }

  const instructionNames = new Set(
    context.agent === 'claude'
      ? ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']
      : context.agent === 'codex'
        ? ['AGENTS.md', 'AGENTS.override.md']
        : ['AGENTS.md', 'GEMINI.md'],
  );
  async function directoryRules(directory: string, relative = '', depth = 0): Promise<void> {
    await eachEntry(directory, async (entry) => {
      if (depth > 0 && entry.isFile() && instructionNames.has(entry.name)) {
        const base: ResourceScan = {
          directory,
          displayPath: relative,
          scope: 'directory',
          mode: 'rules',
        };
        await addExisting(base, entry.name, 'rules');
      }
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) return;
      if (depth < MAX_DIRECTORY_DEPTH)
        await directoryRules(path.join(directory, entry.name), path.posix.join(relative, entry.name), depth + 1);
      else warnings.add('项目目录层级较深，部分目录规则未纳入本次列表。');
    });
  }

  for (const scan of plan.scans) {
    if (scan.mode === 'skills') await skillFiles(scan);
    else if (scan.mode === 'plugins') await pluginFiles(scan);
    else await ruleFiles(scan);
  }
  if (context.project) await directoryRules(context.project.dir);
  return { targets: [...targets.values()], warnings: [...warnings] };
}
