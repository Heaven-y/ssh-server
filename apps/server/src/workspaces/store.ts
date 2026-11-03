// 工作区配置存储：<配置目录>/workspaces.json。只存本工具的配置，删除工作区不碰任何项目文件。
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceInputSchema, WorkspaceSchema, type Workspace, type WorkspaceInput } from '@agentdeck/shared';

export class WorkspaceValidationError extends Error {
  override name = 'WorkspaceValidationError';
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export class WorkspaceStorageError extends Error {
  override name = 'WorkspaceStorageError';
  constructor() {
    super('工作区配置损坏或不可读，已停止读写并保留原文件；请检查配置目录权限或恢复有效配置');
  }
}

export type WorkspaceStore = {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | undefined>;
  /** 锁住工作区列表供跨档案事务使用；回调不得重入本存储。锁序始终为工作区→服务器档案。 */
  withSnapshot<T>(operation: (workspaces: readonly Workspace[]) => Promise<T>): Promise<T>;
  create(input: WorkspaceInput, beforePersist?: (workspace: Workspace) => Promise<void>): Promise<Workspace>;
  update(
    id: string,
    patch: Partial<WorkspaceInput>,
    beforePersist?: (current: Workspace) => void | Promise<void>,
  ): Promise<Workspace | undefined>;
  remove(id: string, beforeRemove?: (current: Workspace) => Promise<void>): Promise<boolean>;
};

export type WorkspaceStoreDeps = {
  configDir: string;
  dirExists(p: string): Promise<boolean>;
  /** 已登记服务器档案的稳定别名；只在输入带了 server 时查询 */
  knownHosts(): Promise<string[]>;
};

const FILE_NAME = 'workspaces.json';
// 落盘文件比接口更严格：id 唯一、dir 必须是绝对路径、server 与 remoteDir 成对出现。
// dir 若非绝对路径，会被下游当作 cwd 直接传给 CLI，等于静默跑错目录；
// server 单独存在时 isBoundWorkspace 判否、任何服务器面板都打不开，却仍占着
// target_referenced 名额。两种情况都会让坏数据继续跑，所以拦住整份配置，
// 让人先去修文件。
const StoredWorkspacesSchema = WorkspaceSchema.array()
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
  .refine((items) => items.every((item) => path.isAbsolute(item.dir)))
  .refine((items) => items.every((item) => (item.server === undefined) === (item.remoteDir === undefined)));

export function createWorkspaceStore(deps: WorkspaceStoreDeps): WorkspaceStore {
  const file = path.join(deps.configDir, FILE_NAME);
  // 所有读写串行执行，避免并发写入时丢失记录
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function load(): Promise<Workspace[]> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new WorkspaceStorageError();
    }
    try {
      return StoredWorkspacesSchema.parse(JSON.parse(text));
    } catch {
      throw new WorkspaceStorageError();
    }
  }

  async function save(list: Workspace[]): Promise<void> {
    await mkdir(deps.configDir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  }

  function parseInput(input: WorkspaceInput): WorkspaceInput {
    const parsed = WorkspaceInputSchema.safeParse(input);
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0]!;
    throw new WorkspaceValidationError(String(issue.path[0] ?? 'input'), issue.message);
  }

  /**
   * server 与 remoteDir 同进同退。只绑服务器却给不出默认目录的项目：
   * isBoundWorkspace 判否、打不开任何服务器面板，却会占住 target_referenced 名额、
   * 挡住服务器档案修改。只给目录不绑服务器同理无法使用。
   */
  function assertBinding(value: WorkspaceInput): void {
    if ((value.server === undefined) === (value.remoteDir === undefined)) return;
    throw new WorkspaceValidationError(
      'remoteDir',
      value.server === undefined ? '未绑定服务器时不能设置服务器目录' : '绑定服务器时必须设置服务器目录',
    );
  }

  /** 目录必须是绝对路径且存在；服务器绑定可选，但 server 与 remoteDir 必须成对出现。 */
  async function validate(input: WorkspaceInput): Promise<WorkspaceInput> {
    const value = parseInput(input);
    if (!path.isAbsolute(value.dir)) throw new WorkspaceValidationError('dir', '项目目录必须是绝对路径');
    const dir = path.resolve(value.dir);
    if (!(await deps.dirExists(dir))) throw new WorkspaceValidationError('dir', '项目目录不存在');
    if (value.server !== undefined && !(await deps.knownHosts()).includes(value.server)) {
      throw new WorkspaceValidationError('server', '服务器未登记，请先保存服务器档案');
    }
    assertBinding(value);
    // 显式重建，避免 update 传入 undefined 时把空键带进落盘文件。
    return {
      name: value.name,
      dir,
      ...(value.server === undefined ? {} : { server: value.server }),
      ...(value.remoteDir === undefined ? {} : { remoteDir: value.remoteDir }),
    };
  }

  return {
    withSnapshot: (operation) => serial(async () => operation(await load())),
    list: () => serial(load),
    get: (id) => serial(async () => (await load()).find((w) => w.id === id)),
    create: (input, beforePersist) =>
      serial(async () => {
        const ws: Workspace = { ...(await validate(input)), id: randomUUID() };
        const list = await load();
        await beforePersist?.(ws);
        await save([...list, ws]);
        return ws;
      }),
    update: (id, patch, beforePersist) =>
      serial(async () => {
        const list = await load();
        const idx = list.findIndex((w) => w.id === id);
        if (idx === -1) return undefined;
        const { id: _id, ...current } = list[idx]!;
        const next: Workspace = { ...(await validate({ ...current, ...patch })), id };
        await beforePersist?.(list[idx]!);
        list[idx] = next;
        await save(list);
        return next;
      }),
    remove: (id, beforeRemove) =>
      serial(async () => {
        const list = await load();
        const current = list.find((workspace) => workspace.id === id);
        if (!current) return false;
        const next = list.filter((w) => w.id !== id);
        await beforeRemove?.(current);
        await save(next);
        return true;
      }),
  };
}
