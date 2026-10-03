import path from 'node:path';
import type { AgentModel } from '@ssh-server/shared';
import { capabilityId, type NativeCapabilityCatalog, type NativeInvocation } from '../capability-types';
import { sameSessionDirectory } from '../session-scope';
import { CodexClient } from './client';
import { cancelled, CodexError, list, record, text, type CodexRuntimeOptions, type RecordValue } from './types';

type Entry = NativeCapabilityCatalog['entries'][number];
const MAX_CATALOG_ITEMS = 10_000;

function commands(): Entry[] {
  return [
    {
      id: capabilityId('codex', 'command', 'compact'),
      kind: 'command',
      name: 'compact',
      description: '使用 Codex 原生压缩当前会话的上下文',
      source: '内置命令',
      available: true,
      requiresSession: true,
      supportsArguments: false,
      invocation: { kind: 'command', name: 'compact' },
    },
    {
      id: capabilityId('codex', 'command', 'context'),
      kind: 'command',
      name: 'context',
      description: '查询当前上下文',
      source: '本机 CLI',
      available: false,
      unavailableReason: '当前 Codex app-server 没有独立上下文查询接口，请在本机 CLI 中查看。',
      requiresSession: true,
      supportsArguments: false,
    },
  ];
}

/** cwd 由服务端工作区提供；不能把其他目录的发现结果当作该工作区的技能。 */
export async function readNativeSkills(
  client: CodexClient,
  dir: string,
): Promise<{ skills: RecordValue[]; hasErrors: boolean }> {
  const response = await client.request('skills/list', { cwds: [dir], forceReload: true });
  if (!Array.isArray(response.data)) throw new CodexError('Codex 未返回有效的技能目录。');
  const entries: RecordValue[] = [];
  for (const value of response.data) {
    const entry = record(value);
    if (await sameSessionDirectory(text(entry.cwd), dir)) entries.push(entry);
  }
  if (!entries.length || entries.some((entry) => !Array.isArray(entry.skills)))
    throw new CodexError('Codex 未返回当前工作区的技能目录。');
  const skills = entries.flatMap((entry) => list(entry.skills).map(record));
  if (skills.length > MAX_CATALOG_ITEMS) throw new CodexError('Codex 技能目录超过读取上限。');
  return { skills, hasErrors: entries.some((entry) => list(entry.errors).length > 0) };
}

function skillEntry(skill: RecordValue): Entry | undefined {
  const name = text(skill.name);
  const skillPath = text(skill.path);
  if (!name || !path.isAbsolute(skillPath)) return;
  const available = skill.enabled === true;
  const scopes: Record<string, string> = { repo: '工作区', user: '用户', system: '内置', admin: '管理员' };
  return {
    id: capabilityId('codex', 'skill', name, skillPath),
    kind: 'skill',
    name,
    description: text(record(skill.interface).shortDescription) || text(skill.description),
    source: `${scopes[text(skill.scope)] ?? '原生技能'} · ${path.basename(path.dirname(skillPath))}`,
    available,
    ...(!available ? { unavailableReason: '此技能已在本机 Codex 中禁用。' } : {}),
    requiresSession: false,
    supportsArguments: true,
    invocation: { kind: 'skill', name, path: skillPath },
  };
}

async function skillsCatalog(client: CodexClient, dir: string): Promise<{ entries: Entry[]; warnings: string[] }> {
  const { skills, hasErrors } = await readNativeSkills(client, dir);
  const entries = new Map<string, Entry>();
  for (const skill of skills) {
    const entry = skillEntry(skill);
    if (entry) entries.set(entry.id, entry);
  }
  return {
    entries: [...entries.values()],
    warnings: hasErrors ? ['部分 Codex 技能无法解析，请检查本机技能文件。'] : [],
  };
}

function modelEntry(value: unknown): AgentModel | undefined {
  const model = record(value);
  const id = text(model.model) || text(model.id);
  if (!id) return;
  return {
    id,
    label: text(model.displayName) || id,
    ...(text(model.description) ? { description: text(model.description) } : {}),
    reasoningEfforts: [
      ...new Set(
        list(model.supportedReasoningEfforts)
          .map((effort) => text(record(effort).reasoningEffort))
          .filter(Boolean),
      ),
    ],
  };
}

function modelCursor(response: RecordValue, cursors: Set<string>): string | undefined {
  if (response.nextCursor !== null && typeof response.nextCursor !== 'string')
    throw new CodexError('Codex 模型目录返回了无效分页信息。');
  const cursor = text(response.nextCursor) || undefined;
  if (cursor) {
    if (cursors.has(cursor)) throw new CodexError('Codex 模型目录分页异常。');
    cursors.add(cursor);
  }
  return cursor;
}

async function modelsCatalog(client: CodexClient): Promise<AgentModel[]> {
  const models = new Map<string, AgentModel>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let count = 0;
  do {
    const response = await client.request('model/list', { limit: 100, includeHidden: false, cursor });
    if (!Array.isArray(response.data)) throw new CodexError('Codex 未返回有效的模型目录。');
    count += response.data.length;
    if (count > MAX_CATALOG_ITEMS || cursors.size >= 100) throw new CodexError('Codex 模型目录超过读取上限。');
    for (const value of response.data) {
      const model = modelEntry(value);
      if (model) models.set(model.id, model);
    }
    cursor = modelCursor(response, cursors);
  } while (cursor);
  return [...models.values()];
}

export async function discoverCodexCapabilities(
  dir: string,
  options: CodexRuntimeOptions = {},
): Promise<NativeCapabilityCatalog> {
  const client = await CodexClient.start({ ...options, cwd: dir });
  try {
    await client.initialize();
    const [skills, models] = await Promise.allSettled([skillsCatalog(client, dir), modelsCatalog(client)]);
    if (options.signal?.aborted) throw cancelled();
    const catalog: NativeCapabilityCatalog = { entries: commands(), models: [], warnings: [] };
    if (skills.status === 'fulfilled') {
      catalog.entries.push(...skills.value.entries);
      catalog.warnings.push(...skills.value.warnings);
    } else catalog.warnings.push('Codex 技能目录读取失败，请检查本机技能配置。');
    if (models.status === 'fulfilled') catalog.models = models.value;
    else catalog.warnings.push('Codex 模型目录读取失败，仍可手动填写模型或使用原生配置。');
    return catalog;
  } finally {
    await client.close();
  }
}

/** 原生会静默忽略失效技能，所以必须在实际运行实例里明确拒绝。 */
export async function validateCodexSkill(
  client: CodexClient,
  dir: string,
  invocation: NativeInvocation,
): Promise<void> {
  if (invocation.kind !== 'skill') return;
  const { skills } = await readNativeSkills(client, dir);
  const matches = skills.filter((skill) => skill.path === invocation.path && skill.name === invocation.name);
  if (!invocation.path || !path.isAbsolute(invocation.path) || matches.length !== 1 || matches[0]?.enabled !== true)
    throw new CodexError('所选 Codex 技能已失效、禁用或存在歧义，请刷新技能目录后重新选择。');
}
