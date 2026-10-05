// 工作区配置存储：<配置目录>/workspaces.json。只存本工具的配置，删除工作区不碰任何项目文件。
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceInputSchema, type Workspace, type WorkspaceInput } from '@ssh-server/shared';

export class WorkspaceValidationError extends Error {
  override name = 'WorkspaceValidationError';
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export type WorkspaceStore = {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | undefined>;
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
  /** ~/.ssh/config 中可用的 Host 别名 */
  knownHosts(): Promise<string[]>;
};

const FILE_NAME = 'workspaces.json';

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
    } catch {
      return []; // 文件不存在
    }
    try {
      const data: unknown = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('不是数组');
      return data.filter(
        (w): w is Workspace => typeof w === 'object' && w !== null && typeof (w as { id?: unknown }).id === 'string',
      );
    } catch {
      // 文件损坏：备份后从空列表开始
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await rename(file, `${file}.bak-${stamp}`).catch(() => undefined);
      return [];
    }
  }

  async function save(list: Workspace[]): Promise<void> {
    await mkdir(deps.configDir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  }

  async function validate(input: WorkspaceInput): Promise<WorkspaceInput> {
    const parsed = WorkspaceInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new WorkspaceValidationError(String(issue.path[0] ?? 'input'), issue.message);
    }
    const value = parsed.data;
    if (!path.isAbsolute(value.localDir)) throw new WorkspaceValidationError('localDir', '本地文件夹必须是绝对路径');
    const localDir = path.resolve(value.localDir);
    if (!(await deps.dirExists(localDir))) throw new WorkspaceValidationError('localDir', '本地文件夹不存在');
    if (!(await deps.knownHosts()).includes(value.sshHost)) {
      throw new WorkspaceValidationError('sshHost', `~/.ssh/config 中没有 Host ${value.sshHost}`);
    }
    return { ...value, localDir };
  }

  return {
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
