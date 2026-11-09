import path from 'node:path';
import { capabilityId, type NativeCapabilityCatalog } from '../capability-types';
import { managementObject as object, managementText as text, type ManagementRecord } from './management-rpc';
import { parseAntigravityModelList } from './model-catalog';

type Entry = NativeCapabilityCatalog['entries'][number];
export type NativeSkill = ManagementRecord & { name: string; path: string };
const MAX_ENTRIES = 10_000;
const safeName = (name: string) =>
  name.length > 0 &&
  name.length <= 200 &&
  !/[\s/\\]/u.test(name) &&
  [...name].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);

function commandReason(name: string): string {
  const actions: Record<string, string> = {
    model: '请使用输入区的模型菜单。',
    effort: '请使用模型菜单中的思考强度。',
    permissions: '请使用输入区的权限菜单。',
    config: '请打开设置。',
    help: '请在此面板查看当前技能与命令。',
    skills: '当前技能已列在此面板中。',
    hooks: '请打开设置中的 CLI 配置文件。',
  };
  return actions[name] ?? '此原生命令暂未接入工作台。';
}

/** 只接受本机 /help 的两列格式；内建界面命令不能作为模型提示词发送。 */
export function antigravityCommandEntries(output: string): Entry[] {
  return parseAntigravityModelList(output).map(({ id, label }) => {
    const match = /^\/([^\s/\\]+)(?: \(([^)]+)\))?$/.exec(id);
    const name = match?.[1] ?? '';
    const aliases = match?.[2]?.split(/,\s*/);
    if (!safeName(name) || aliases?.some((alias) => !safeName(alias))) throw new Error('原生命令目录格式发生变化');
    return {
      id: capabilityId('antigravity', 'command', name),
      kind: 'command',
      name,
      description: label,
      aliases,
      source: 'Antigravity 原生命令',
      available: false,
      unavailableReason: commandReason(name),
      requiresSession: false,
      supportsArguments: false,
    };
  });
}

export function antigravityNativeSkills(value: ManagementRecord): NativeSkill[] {
  if (!Array.isArray(value.skills) || value.skills.length > MAX_ENTRIES) throw new Error('原生技能目录格式发生变化');
  return value.skills
    .map(object)
    .filter((skill): skill is NativeSkill => safeName(text(skill.name)) && path.isAbsolute(text(skill.path)));
}

function isWorkspaceSkill(skill: NativeSkill): boolean {
  return !!object(skill.scope).localScope;
}

/** 1.5.1 实测：工作区优先，随后是 CLI 私有、Shared、普通全局；清单继承由原生解析。 */
export function mergeAntigravitySkills(
  normal: NativeSkill[],
  shared: NativeSkill[],
  cli: NativeSkill[],
): NativeSkill[] {
  const selected = new Map(normal.filter((skill) => skill.isBuiltin !== true).map((skill) => [skill.name, skill]));
  for (const skill of [...shared, ...cli]) {
    if (skill.isBuiltin === true || isWorkspaceSkill(selected.get(skill.name) ?? skill)) continue;
    selected.set(skill.name, skill);
  }
  return [...selected.values()];
}

function skillEntry(name: string, description: string, skill?: NativeSkill): Entry {
  const available = skill?.disableSlashCommand !== true;
  const skillPath = skill?.path;
  return {
    id: capabilityId('antigravity', 'skill', name, skillPath ?? 'builtin'),
    kind: 'skill',
    name,
    description,
    source: skillPath ? 'Antigravity 原生技能' : '内置技能',
    available,
    unavailableReason: available ? undefined : '此技能已关闭斜杠调用。',
    requiresSession: false,
    supportsArguments: true,
    invocation: { kind: 'skill', name, ...(skillPath ? { path: skillPath } : {}) },
  };
}

export function antigravitySkillEntries(builtinOutput: string, skills: NativeSkill[], commands: Entry[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const builtin of parseAntigravityModelList(builtinOutput)) {
    if (!safeName(builtin.id)) throw new Error('原生技能目录格式发生变化');
    entries.set(builtin.id, skillEntry(builtin.id, builtin.label));
  }
  for (const skill of skills) entries.set(skill.name, skillEntry(skill.name, text(skill.description), skill));
  if (entries.size > MAX_ENTRIES) throw new Error('原生技能目录超过读取上限');
  const reserved = new Set(commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
  return [...entries.values()].map((entry) =>
    reserved.has(entry.name) ? { ...entry, available: false, unavailableReason: '此名称与原生命令冲突。' } : entry,
  );
}
