// 字段级转换：把已经位于新数据目录里的旧版 workspaces.json 改写成当前结构。
// 与 migrate-legacy.ts 分工：那个只负责把旧目录里的文件原样复制到新目录，这里才改字段，也不去找旧路径。
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceSchema, type Workspace } from '@agentdeck/shared';
import type { WorkspaceStore } from './store';

const FILE_NAME = 'workspaces.json';
/** 当前落盘结构声明的键；其余键（localDir、sshHost、sync、policy 等）都是旧版本遗留，转换时丢弃。 */
const NEW_KEYS = new Set(['id', 'name', 'dir', 'server', 'remoteDir']);

export type ImportReport = {
  /** 成功转换并写入的条数 */
  imported: number;
  /** 结构不合法、目录不可用或 id 重复而跳过的条数 */
  skipped: number;
  /** 旧文件保留下来的备份路径 */
  backupFiles: string[];
  /** 未能迁移或只完成一部分时的中文说明 */
  message?: string;
};

export type ImportDeps = {
  configDir: string;
  // 依赖里保留 store 以统一启动接线。导入必须跳过 store.create()——那会生成新 UUID、丢掉旧 id，
  // 所以这里直接写文件，写法与 store.ts 的 save() 保持一致（临时文件写完再 rename）。
  store: WorkspaceStore;
};

const emptyReport = (): ImportReport => ({ imported: 0, skipped: 0, backupFiles: [] });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 只取非空字符串；旧字段可能是数字或 null，一律当作没有。 */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * 显式重建一条记录：旧 localDir/sshHost 改名为 dir/server，其余键全部丢弃。
 * 绝不展开原对象，否则 sync、policy 等旧字段会被原样带进新文件。
 */
function candidate(entry: Record<string, unknown>): Record<string, unknown> {
  const dir = text(entry.dir) ?? text(entry.localDir);
  const server = text(entry.server) ?? text(entry.sshHost);
  const remoteDir = text(entry.remoteDir);
  return {
    id: entry.id,
    name: entry.name,
    ...(dir === undefined ? {} : { dir }),
    ...(server === undefined ? {} : { server }),
    ...(remoteDir === undefined ? {} : { remoteDir }),
  };
}

/**
 * 与 store.load() 同一套落盘约束：schema 通过、目录是绝对路径、server 与 remoteDir 同进同退。
 * 任何一条不满足都只影响这一条，绝不能把坏数据写回去让整份配置读不出来。
 */
function storedWorkspace(entry: unknown): Workspace | undefined {
  if (!isRecord(entry)) return undefined;
  const parsed = WorkspaceSchema.safeParse(candidate(entry));
  if (!parsed.success) return undefined;
  if (!path.isAbsolute(parsed.data.dir)) return undefined;
  const bound = parsed.data.server !== undefined;
  if (bound !== (parsed.data.remoteDir !== undefined)) return undefined;
  return parsed.data;
}

/** 每一项都已经是合法的新结构、且 id 不重复时无需转换（空数组同样视为已转换）。 */
function looksConverted(items: unknown[]): boolean {
  const workspaces = items.map((item) => {
    if (!isRecord(item) || !Object.keys(item).every((key) => NEW_KEYS.has(key))) return undefined;
    return storedWorkspace(item);
  });
  if (!workspaces.every((item): item is Workspace => item !== undefined)) return false;
  return new Set(workspaces.map((item) => item.id)).size === workspaces.length;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 不是合法数组时返回 undefined，交给调用方决定是否保留原文件。 */
function parseItems(raw: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 单条转换：坏数据只跳过这一条。
 * - 目录不是绝对路径或已不存在：跳过，不猜用户想指向哪里。
 * - server 与 remoteDir 只出现一半：跳过，不替用户补默认目录，那会凭空造出他没配过的路径。
 * - id 重复：只保留第一条，否则整份配置过不了唯一性校验。
 */
async function convertOne(entry: unknown, seen: Set<string>): Promise<Workspace | undefined> {
  const workspace = storedWorkspace(entry);
  if (workspace === undefined) return undefined;
  const dir = path.resolve(workspace.dir);
  if (!(await dirExists(dir))) return undefined;
  if (seen.has(workspace.id)) return undefined;
  seen.add(workspace.id);
  return { ...workspace, dir };
}

/** 与 store.ts 的 save() 相同的原子写法：临时文件写完再 rename。 */
async function writeWorkspaces(file: string, list: Workspace[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * 选一个不会覆盖已有数据的备份路径。
 * 已有 .bak 时另起一个带时间戳的名字——那可能是更早一次转换留下的原始数据，
 * 被后来的坏文件顶掉就再也找不回来了。
 */
async function backupPathFor(file: string): Promise<string> {
  const plain = `${file}.bak`;
  if (!(await exists(plain))) return plain;
  return `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
}

/**
 * 把 <configDir>/workspaces.json 从旧结构转换成新结构。
 * 没有文件、文件已解析失败或已经是新结构时都不动它；转换时先把原文件改名为备份，再原子写新文件。
 */
export async function importLegacyWorkspaces(deps: ImportDeps): Promise<ImportReport> {
  const file = path.join(deps.configDir, FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyReport();
    return { ...emptyReport(), message: `旧配置无法读取，未迁移：${(error as Error).message}` };
  }

  const items = parseItems(raw);
  if (items === undefined) {
    // 解析不了就把原文件原样留在原地，宁可让用户手工修，也不覆盖他的数据。
    return { ...emptyReport(), message: '旧配置无法解析，未迁移，原文件保留在配置目录' };
  }
  if (looksConverted(items)) return emptyReport();

  const target = await backupPathFor(file);
  try {
    // 先改名再写新文件，避免写回时自己覆盖自己；旧文件保留为备份，不删除。
    await rename(file, target);
  } catch (error) {
    return { ...emptyReport(), message: `旧配置无法备份，未迁移：${(error as Error).message}` };
  }

  const list: Workspace[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const item of items) {
    const workspace = await convertOne(item, seen);
    if (workspace === undefined) {
      skipped += 1;
      continue;
    }
    list.push(workspace);
  }

  try {
    await writeWorkspaces(file, list);
  } catch (error) {
    return {
      imported: 0,
      skipped,
      backupFiles: [target],
      message: `旧配置已备份为 ${path.basename(target)}，但写入新配置失败：${(error as Error).message}`,
    };
  }
  return { imported: list.length, skipped, backupFiles: [target] };
}
