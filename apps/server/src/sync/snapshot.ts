// rclone 只操作本机状态目录中的稳定镜像，回写前核对真实文件的内容与身份。
import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { SyncConflict, SyncSettings, Workspace } from '@ssh-server/shared';
import { SyncError } from './errors';
import { eligibleFile, safeRelativePath } from './filters';
import { hash, localInventory, workspaceStateDir, type FileEntry } from './inventory';

type Original = { digest: string; stat: Stats };
type Version = Original & { data: Buffer };
type Input = { configDir: string; ws: Workspace; settings: SyncSettings };
export type StagedSnapshot = {
  localDir: string;
  inventory: FileEntry[];
  all: FileEntry[];
  apply(): Promise<SyncConflict[]>;
};
const changed = () => new SyncError('snapshot_changed', '本地文件在建立镜像期间变化，已停止同步，请重试');
const unsafe = () => new SyncError('unsafe_path', '同步路径经过符号链接或非普通目录，已停止');
const statKey = (stat: Stats) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs].join(':');
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
async function statIfPresent(file: string): Promise<Stats | undefined> {
  try {
    return await lstat(file);
  } catch (error) {
    if (!missing(error)) throw error;
    return undefined;
  }
}
async function directory(dir: string, create: boolean): Promise<boolean> {
  if (create)
    await mkdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  const stat = await statIfPresent(dir);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe();
  return true;
}
async function checkedRoot(root: string, create = false): Promise<void> {
  const absolute = path.resolve(root);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!(await directory(current, create))) throw unsafe();
  }
}
async function checkedPath(root: string, relative: string, create = false): Promise<string | undefined> {
  safeRelativePath(relative);
  await checkedRoot(root);
  const parts = relative.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (!(await directory(current, create))) return undefined;
  }
  const target = path.join(root, ...parts);
  const stat = await statIfPresent(target);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw unsafe();
  return target;
}
// 删除批准的最后一次校验也覆盖父目录；不为缺失路径创建目录。
export async function localFileMissing(root: string, relative: string): Promise<boolean> {
  const target = await checkedPath(root, relative);
  return !target || !(await statIfPresent(target));
}
function contains(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function clearMirror(root: string): Promise<void> {
  await checkedRoot(root);
  for (const item of await readdir(root)) {
    safeRelativePath(item);
    const target = path.join(root, item);
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) await unlink(target);
    else {
      await clearMirror(target);
      await rmdir(target);
    }
  }
}
async function mirrorDirectory(input: Input): Promise<string> {
  const stateDir = workspaceStateDir(input.configDir, input.ws.id);
  if (contains(input.ws.localDir, stateDir) || contains(stateDir, input.ws.localDir)) throw unsafe();
  const mirror = path.join(stateDir, 'mirror');
  await checkedRoot(mirror, true);
  await clearMirror(mirror);
  return mirror;
}
async function readBuffer(handle: FileHandle, size: number): Promise<Buffer> {
  const data = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < data.length) {
    const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset !== size) throw changed();
  return data.subarray(0, size);
}
async function sameTarget(root: string, relative: string, stat: Stats): Promise<boolean> {
  const target = await checkedPath(root, relative);
  if (!target) return false;
  const current = await statIfPresent(target);
  return !!current && statKey(current) === statKey(stat);
}
async function handleVersion(handle: FileHandle, stat: Stats): Promise<Version> {
  if (statKey(await handle.stat()) !== statKey(stat)) throw changed();
  const data = await readBuffer(handle, stat.size);
  if (statKey(await handle.stat()) !== statKey(stat)) throw changed();
  return { data, digest: hash(data), stat };
}
async function readVersion(
  root: string,
  relative: string,
  settings: SyncSettings,
  expected?: FileEntry,
): Promise<Version | undefined> {
  const target = await checkedPath(root, relative);
  if (!target) return undefined;
  const stat = await statIfPresent(target);
  if (!stat) return undefined;
  if (!eligibleFile(relative, stat.size, settings))
    throw new SyncError('filter_changed', '文件在读取期间超出同步范围，已停止');
  if (expected && (stat.size !== expected.size || stat.mtime.toISOString() !== expected.modTime)) throw changed();
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error: unknown) => {
    if (!missing(error)) throw error;
    return undefined;
  });
  if (!handle) return undefined;
  try {
    const version = await handleVersion(handle, stat);
    if (!(await sameTarget(root, relative, stat))) throw changed();
    return version;
  } finally {
    await handle.close();
  }
}
async function requiredVersion(root: string, file: FileEntry, settings: SyncSettings): Promise<Version> {
  const version = await readVersion(root, file.path, settings, file);
  if (!version) throw changed();
  return version;
}
async function writeNew(root: string, relative: string, version: Version): Promise<boolean> {
  const target = await checkedPath(root, relative, true);
  if (!target) throw unsafe();
  const handle = await open(target, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
    return undefined;
  });
  if (!handle) return false;
  try {
    await handle.writeFile(version.data);
    await handle.utimes(version.stat.atime, version.stat.mtime);
  } finally {
    await handle.close();
  }
  return true;
}
function unchanged(original: Original, current: Original | undefined): boolean {
  return !!current && original.digest === current.digest && statKey(original.stat) === statKey(current.stat);
}
const sameContent = (first: Original | undefined, second: Original | undefined) => first?.digest === second?.digest;
type Update = { root: string; file: string; original: Original; remote?: Version };
async function updateExisting(input: Update): Promise<boolean> {
  const target = await checkedPath(input.root, input.file);
  if (!target) return false;
  const handle = await open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)).catch((error: unknown) => {
    if (!missing(error)) throw error;
    return undefined;
  });
  if (!handle) return false;
  try {
    const stat = await handle.stat();
    if (statKey(stat) !== statKey(input.original.stat)) return false;
    const current = await handleVersion(handle, stat);
    if (!unchanged(input.original, current) || !(await sameTarget(input.root, input.file, stat))) return false;
    if (input.remote) {
      await handle.writeFile(input.remote.data);
      await handle.truncate(input.remote.data.length);
      await handle.utimes(input.remote.stat.atime, input.remote.stat.mtime);
    } else await unlink(target);
    return true;
  } finally {
    await handle.close();
  }
}
type ApplyFile = { root: string; file: string; original?: Original; remote?: Version; settings: SyncSettings };
async function keepConflict(input: ApplyFile, current: Version | undefined): Promise<SyncConflict | undefined> {
  if (sameContent(current, input.remote)) return undefined;
  const suffix = randomUUID();
  const conflict = {
    path: input.file,
    localCopy: `${input.file}.ssh-local-conflict-${suffix}`,
    remoteCopy: `${input.file}.ssh-remote-conflict-${suffix}`,
  };
  // 缺失一侧保留缺失状态，不用旧快照冒充用户当前版本。
  if (current) await writeNew(input.root, conflict.localCopy, current);
  if (input.remote) await writeNew(input.root, conflict.remoteCopy, input.remote);
  return conflict;
}
async function applyFile(input: ApplyFile): Promise<SyncConflict | undefined> {
  if (sameContent(input.original, input.remote)) return undefined;
  let current = await readVersion(input.root, input.file, input.settings);
  if (input.original && unchanged(input.original, current)) {
    if (await updateExisting({ ...input, original: input.original })) return undefined;
    current = await readVersion(input.root, input.file, input.settings);
  } else if (!input.original && !current && input.remote) {
    if (await writeNew(input.root, input.file, input.remote)) return undefined;
    current = await readVersion(input.root, input.file, input.settings);
  }
  return keepConflict(input, current);
}
async function applyMirror(input: Input, mirror: string, originals: Map<string, Original>): Promise<SyncConflict[]> {
  const inventory = await localInventory(mirror, input.settings);
  if (inventory.all.some((file) => !eligibleFile(file.path, file.size, input.settings)))
    throw new SyncError('filter_changed', '镜像包含超出同步范围的文件，已停止回写');
  const remote = new Map(inventory.included.map((file) => [file.path, file]));
  const conflicts: SyncConflict[] = [];
  for (const file of new Set([...originals.keys(), ...remote.keys()])) {
    const entry = remote.get(file);
    const version = entry ? await requiredVersion(mirror, entry, input.settings) : undefined;
    const conflict = await applyFile({
      root: input.ws.localDir,
      settings: input.settings,
      file,
      original: originals.get(file),
      remote: version,
    });
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}
async function verifySources(input: Input, originals: Map<string, Original>): Promise<void> {
  const current = await localInventory(input.ws.localDir, input.settings);
  if (current.included.length !== originals.size) throw changed();
  for (const file of current.included) {
    const original = originals.get(file.path);
    if (!original || !unchanged(original, await requiredVersion(input.ws.localDir, file, input.settings)))
      throw changed();
  }
}
export async function stageSnapshot(input: Input): Promise<StagedSnapshot> {
  await checkedRoot(input.ws.localDir);
  const source = await localInventory(input.ws.localDir, input.settings);
  const mirror = await mirrorDirectory(input);
  const originals = new Map<string, Original>();
  for (const file of source.included) {
    const version = await requiredVersion(input.ws.localDir, file, input.settings);
    originals.set(file.path, { digest: version.digest, stat: version.stat });
    await writeNew(mirror, file.path, version);
  }
  await verifySources(input, originals);
  return {
    localDir: mirror,
    inventory: (await localInventory(mirror, input.settings)).included,
    all: source.all,
    apply: () => applyMirror(input, mirror, originals),
  };
}
