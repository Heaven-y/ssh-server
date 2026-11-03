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
  /** 已登记服务器档案的稳定别名 */
  knownHosts(): Promise<string[]>;
};

const FILE_NAME = 'workspaces.json';
// 落盘文件比接口更严格：id 唯一、dir 必须是绝对路径。
// dir 若非绝对路径，会被下游当作 cwd 直接传给 CLI，等于静默跑错目录，
// 所以这里拦住整份配置，让人先去修文件，而不是带着坏数据继续跑。
const StoredWorkspacesSchema = WorkspaceSchema.array()
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
  .refine((items) => items.every((item) => path.isAbsolute(item.dir)));

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

  /** 目录必须是绝对路径且存在；服务器绑定可选，但一旦提供就必须已登记。 */
  async function validate(input: WorkspaceInput): Promise<WorkspaceInput> {
    const parsed = WorkspaceInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new WorkspaceValidationError(String(issue.path[0] ?? 'input'), issue.message);
    }
    const value = parsed.data;
    if (!path.isAbsolute(value.dir)) throw new WorkspaceValidationError('dir', '项目目录必须是绝对路径');
    const dir = path.resolve(value.dir);
    if (!(await deps.dirExists(dir))) throw new WorkspaceValidationError('dir', '项目目录不存在');
    if (value.server !== undefined && !(await deps.knownHosts()).includes(value.server)) {
      throw new WorkspaceValidationError('server', '服务器未登记，请先保存服务器档案');
    }
    // 默认目录只在绑定服务器时有意义，避免出现「有目录没服务器」的半绑定状态。
    if (value.remoteDir !== undefined && value.server === undefined)
      throw new WorkspaceValidationError('remoteDir', '未绑定服务器时不能设置默认目录');
    return { ...value, dir };
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
