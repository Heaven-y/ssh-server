import type { AgentKind } from '@agentdeck/shared/conversation';
import type {
  NativeResource,
  NativeResourceGuidance,
  NativeResourceKind,
  NativeResourceRoot,
  NativeResourceScope,
} from '@agentdeck/shared/settings';
import { createHash } from 'node:crypto';
import path from 'node:path';

export type Base = { directory: string; displayPath: string; scope: NativeResourceScope };
export type ResourceTarget = Omit<NativeResource, 'exists' | 'editable'> & { file: string };
export type ResourceRoot = Omit<NativeResourceRoot, 'editable'> & { directory: string };
export type ResourceScan = Base & { mode: 'rules' | 'skills' | 'policy' | 'plugins' };
export type ResourcePlan = {
  targets: ResourceTarget[];
  roots: ResourceRoot[];
  scans: ResourceScan[];
  guidance: NativeResourceGuidance[];
};
export type ResourceContext = {
  agent: AgentKind;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  project?: { id: string; dir: string };
};

export function resourcePathKey(file: string): string {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function resourceId(agent: AgentKind, file: string, kind = 'file'): string {
  return createHash('sha256')
    .update(JSON.stringify([agent, kind, resourcePathKey(file)]))
    .digest('hex');
}

export function at(base: Base, relative: string): Base {
  return {
    ...base,
    directory: path.join(base.directory, relative),
    displayPath: path.posix.join(base.displayPath, relative.split(path.sep).join('/')),
  };
}

export function makeResourceTarget(
  agent: AgentKind,
  base: Base,
  relative: string,
  details: { kind: NativeResourceKind; label?: string; description?: string },
): ResourceTarget {
  const location = at(base, relative);
  const suffix = path.extname(relative).toLowerCase();
  const format = suffix === '.json' ? 'json' : suffix === '.toml' ? 'toml' : suffix === '.md' ? 'markdown' : 'text';
  return {
    id: resourceId(agent, location.directory),
    agent,
    kind: details.kind,
    scope: base.scope,
    label: details.label ?? relative,
    displayPath: location.displayPath,
    format,
    description: details.description ?? '保存原生文件；加载时机、信任与权限由 CLI 决定。',
    file: location.directory,
  };
}

export function builder(context: ResourceContext) {
  const plan: ResourcePlan = { targets: [], roots: [], scans: [], guidance: [] };
  const file = (base: Base, relative: string, kind: NativeResourceKind, description?: string) => {
    plan.targets.push(makeResourceTarget(context.agent, base, relative, { kind, description }));
  };
  const scan = (base: Base, relative: string, mode: ResourceScan['mode'], create = false) => {
    const location = at(base, relative);
    plan.scans.push({ ...location, mode });
    if (create && (mode === 'rules' || mode === 'skills'))
      plan.roots.push({
        id: resourceId(context.agent, location.directory, mode),
        kind: mode,
        scope: base.scope,
        label: mode === 'rules' ? '规则目录' : 'Skills 目录',
        displayPath: location.displayPath,
        directory: location.directory,
      });
  };
  return { plan, file, scan };
}
export type Builder = ReturnType<typeof builder>;

export function userBase(context: ResourceContext, folder: string, override?: string): Base {
  return {
    directory: path.resolve(override || path.join(context.homeDir, folder)),
    displayPath: override ? path.resolve(override) : `~/${folder}`,
    scope: 'user',
  };
}
export function projectBase(context: ResourceContext): Base | undefined {
  return context.project
    ? { directory: path.resolve(context.project.dir), displayPath: '', scope: 'project' }
    : undefined;
}
