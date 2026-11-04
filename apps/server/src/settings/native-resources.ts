import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type {
  AgentKind,
  NativeResourceCatalog,
  NativeResourceCreateInput,
  NativeResourceDocument,
  NativeResourceSaveInput,
  NativeResourceSaved,
} from '@agentdeck/shared';
import { makeResourceTarget, resourcePlan, type ResourceTarget } from './native-resources-catalog';
import { describeResource, describeRoot, discoverResources } from './native-resources-discovery';
import { NativeResourceError, resourceError } from './native-resources-errors';
import { nativeFileTransaction } from './native-resources-transactions';
import {
  assertDirectoryUnchanged,
  contentRevision,
  decodeUtf8,
  inspectDirectory,
  MAX_CONFIG_BYTES,
  readConfigFile,
  writeConfigFile,
} from './safe-file';

export type NativeResourceProject = { id: string; dir: string };
type Deps = { homeDir?: string; env?: NodeJS.ProcessEnv; onSaved?: (agent: AgentKind) => void | Promise<void> };

function validateContent(target: ResourceTarget, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_CONFIG_BYTES) throw new NativeResourceError('too_large');
  if (decodeUtf8(data) !== content) throw new NativeResourceError('invalid_utf8');
  const text = content.replace(/^\uFEFF/, '');
  try {
    if (target.format === 'toml') parseToml(text);
    if (target.format === 'json') {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    }
  } catch {
    throw new NativeResourceError(target.format === 'toml' ? 'invalid_toml' : 'invalid_json');
  }
  return data;
}

function simpleName(name: string): string {
  // Windows 保留名、路径分隔、ADS、尾随点/空格在所有平台统一拒绝。
  if (
    !name ||
    name.length > 100 ||
    /[<>:"/\\|?*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    name === '.' ||
    name === '..'
  )
    throw new NativeResourceError('invalid_request');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new NativeResourceError('invalid_request');
  if (Buffer.from(name, 'utf8').toString('utf8') !== name) throw new NativeResourceError('invalid_request');
  return name;
}

export function createNativeResourcesService(deps: Deps = {}) {
  const homeDir = path.resolve(deps.homeDir ?? os.homedir());
  const env = deps.env ?? process.env;
  function context(agent: AgentKind, project?: NativeResourceProject) {
    if (!['claude', 'codex', 'antigravity'].includes(agent)) throw new NativeResourceError('invalid_agent');
    return { agent, homeDir, env, project };
  }
  async function catalog(agent: AgentKind, project?: NativeResourceProject) {
    const current = context(agent, project);
    const plan = resourcePlan(current);
    const discovered = await discoverResources(current, plan);
    return { plan, ...discovered };
  }
  async function target(agent: AgentKind, id: string, project?: NativeResourceProject) {
    const { targets } = await catalog(agent, project);
    const resource = targets.find((entry) => entry.id === id);
    if (!resource) throw new NativeResourceError('resource_missing');
    return resource;
  }
  function transaction<T>(file: string, action: () => Promise<T>): Promise<T> {
    return nativeFileTransaction(file, action).catch((error: unknown) => {
      throw resourceError(error);
    });
  }
  async function saveTarget(resource: ResourceTarget, input: NativeResourceSaveInput): Promise<NativeResourceSaved> {
    return transaction(resource.file, async () => {
      const data = validateContent(resource, input.content);
      await inspectDirectory(path.dirname(resource.file));
      const previous = await readConfigFile(resource.file);
      if (previous.revision !== input.revision) throw new NativeResourceError('revision_conflict');
      const parents = await inspectDirectory(path.dirname(resource.file), true);
      await writeConfigFile(resource.file, data, previous, parents!);
      await deps.onSaved?.(resource.agent);
      return { resource: await describeResource(resource), revision: contentRevision(data) };
    });
  }
  return {
    async list(agent: AgentKind, project?: NativeResourceProject): Promise<NativeResourceCatalog> {
      const { plan, targets, warnings } = await catalog(agent, project);
      return {
        agent,
        ...(project ? { projectId: project.id } : {}),
        entries: await Promise.all(targets.map(describeResource)),
        roots: await Promise.all(plan.roots.map(describeRoot)),
        guidance: plan.guidance,
        warnings,
      };
    },
    async open(agent: AgentKind, id: string, project?: NativeResourceProject): Promise<NativeResourceDocument> {
      const resource = await target(agent, id, project);
      return transaction(resource.file, async () => {
        const parents = await inspectDirectory(path.dirname(resource.file));
        const snapshot = parents ? await readConfigFile(resource.file) : { content: '', revision: 'missing' };
        if (parents) await assertDirectoryUnchanged(parents);
        return { resource: await describeResource(resource), content: snapshot.content, revision: snapshot.revision };
      });
    },
    async save(
      agent: AgentKind,
      id: string,
      input: NativeResourceSaveInput,
      project?: NativeResourceProject,
    ): Promise<NativeResourceSaved> {
      return saveTarget(await target(agent, id, project), input);
    },
    async create(
      agent: AgentKind,
      input: NativeResourceCreateInput,
      project?: NativeResourceProject,
    ): Promise<NativeResourceSaved> {
      const plan = resourcePlan(context(agent, project));
      const root = plan.roots.find((entry) => entry.id === input.rootId);
      if (!root) throw new NativeResourceError('resource_missing');
      const name = simpleName(input.name);
      if (root.kind === 'skills' && (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)))
        throw new NativeResourceError('invalid_request');
      const relative =
        root.kind === 'skills' ? path.join(name, 'SKILL.md') : name.endsWith('.md') ? name : `${name}.md`;
      const resource = makeResourceTarget(agent, root, relative, { kind: root.kind });
      return saveTarget(resource, { content: input.content, revision: 'missing' });
    },
  };
}
export type NativeResourcesService = ReturnType<typeof createNativeResourcesService>;
