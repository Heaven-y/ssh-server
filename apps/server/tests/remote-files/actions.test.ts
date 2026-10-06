import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import type { Workspace } from '@ssh-server/shared';
import { createFilePreflights, type FilePreflights, type PreparedAction } from '../../src/remote-files/preflight';
import { createFileTasks } from '../../src/remote-files/tasks';
import { RemoteFilesError } from '../../src/remote-files/errors';
import type { RemoteExecutor } from '../../src/remote-files/executor';
import type { SshPool } from '../../src/ssh/pool';
import { registerRemoteFileActionRoutes } from '../../src/http/remote-file-actions.routes';
import type { FileDownloads } from '../../src/remote-files/downloads';
import { createWorkspaceActivity } from '../../src/workspaces/activity';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const remoteHome = path.posix.join(path.posix.sep, 'fixture-home');
const root = path.posix.join(remoteHome, 'project');
const source = path.posix.join(remoteHome, 'outside', 'source.py');
const destination = path.posix.join(remoteHome, 'outside', 'target.py');
const ws: Workspace = {
  id: 'w1',
  name: '测试工作区',
  sshHost: 'my-server',
  remoteDir: root,
  localDir: path.join(os.tmpdir(), 'mirror'),
};

function actionFixture(): PreparedAction {
  const id = randomUUID();
  return {
    public: {
      id,
      workspaceId: ws.id,
      sshHost: ws.sshHost,
      kind: 'move',
      source,
      destination,
      expiresAt: Date.now() + 120000,
      sourceType: 'file',
      entries: 1,
      files: 1,
      bytes: 4,
      affectedWorkspaces: [],
      warnings: [],
      crossFilesystem: false,
      canSubmit: true,
    },
    context: {
      workspace: ws,
      info: { id: randomUUID(), workspaceId: ws.id, sshHost: ws.sshHost, home: remoteHome, root },
      key: 'fixture-key',
      generation: 0,
    },
    plan: {
      kind: 'move',
      roots: [root],
      source,
      destination,
      sourceFacts: ['1', '2', '33188', '4', '5', '6'],
      sourceType: 'file',
      sourceDigest: 'a'.repeat(64),
      sourceParent: ['1', '3', '16877'],
      destinationParent: ['1', '4', '16877'],
      entries: 1,
      files: 1,
      bytes: 4,
      crossFilesystem: false,
    },
    roots: [path.posix.join(remoteHome, 'linked-project')],
    identity: 'a'.repeat(64),
    configurations: [{ id: ws.id, key: 'fixture-config' }],
  };
}

async function tasksFixture(
  run: RemoteExecutor['run'],
  action = actionFixture(),
  acquireWorkspace?: (id: string) => () => void,
) {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'file-tasks-'));
  cleanups.push(() => rm(configDir, { recursive: true, force: true }));
  const preflights: FilePreflights = {
    create: vi.fn(),
    closeWorkspace: vi.fn(),
    validate: vi.fn(async () => undefined),
    take: vi.fn(() => structuredClone(action)),
  };
  const executor = { run: vi.fn(run) };
  const corrupt = vi.fn();
  const deps = { configDir, preflights, executor, onCorrupt: corrupt, acquireWorkspace };
  const tasks = createFileTasks(deps);
  cleanups.push(() => tasks.dispose());
  return { tasks, action, executor, preflights, deps, corrupt, dir: path.join(configDir, 'remote-file-tasks') };
}

it('跨工作区提交从异步复验前持有全部租约，部分获取失败释放已取得租约', async () => {
  const activity = createWorkspaceActivity();
  const action = actionFixture();
  action.public.affectedWorkspaces = [{ id: 'other', name: '另一个项目', remoteRoot: root }];
  const fixture = await tasksFixture(async () => ({ completed: true }), action, activity.acquire);
  let finish!: () => void;
  const validation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.mocked(fixture.preflights.validate).mockImplementationOnce(() => validation);
  const submission = fixture.tasks.submit(ws.id, action.public.id);
  try {
    await vi.waitFor(() => expect(activity.active('other')).toBe(1));
    for (const id of [ws.id, 'other'])
      await expect(activity.exclusive(id, async () => undefined)).rejects.toMatchObject({ code: 'workspace_busy' });
  } finally {
    finish();
  }
  await submission;
  await fixture.tasks.dispose();
  expect(activity.active(ws.id)).toBe(0);
  expect(activity.active('other')).toBe(0);
  // closing第二项时第一项已获取；失败必须全部归还，且不开始异步复验。
  const rejected = await tasksFixture(async () => ({ completed: true }), action, activity.acquire);
  await activity.exclusive('other', async () => {
    await expect(rejected.tasks.submit(ws.id, action.public.id)).rejects.toMatchObject({ code: 'workspace_deleting' });
    expect(activity.active(ws.id)).toBe(0);
    expect(rejected.preflights.validate).not.toHaveBeenCalled();
  });
});

it('冷启动阻断遍历全部持久任务及受影响工作区，不受100项展示限制', async () => {
  const fixture = await tasksFixture(async () => ({ completed: true }));
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await fixture.tasks.dispose();
  const record = JSON.parse(await readFile(path.join(fixture.dir, task.id + '.json'), 'utf8'));
  record.task.phase = 'needs_check';
  record.task.createdAt = 0;
  record.action.public.affectedWorkspaces = [{ id: 'other', name: '受影响项目', remoteRoot: root }];
  await writeFile(path.join(fixture.dir, task.id + '.json'), JSON.stringify(record));
  for (let index = 1; index <= 101; index++) {
    const completed = structuredClone(record);
    completed.task.id = randomUUID();
    completed.task.phase = 'completed';
    completed.task.syncRequired = false;
    completed.task.syncCompleted = true;
    completed.task.createdAt = index;
    await writeFile(path.join(fixture.dir, completed.task.id + '.json'), JSON.stringify(completed));
  }
  const restored = createFileTasks(fixture.deps);
  cleanups.push(() => restored.dispose());
  const list = await restored.list(ws.id);
  expect(list).toHaveLength(100);
  expect(list.every((item) => item.phase === 'completed')).toBe(true);
  for (const id of [ws.id, 'other'])
    expect(await restored.blockers(id)).toContainEqual(expect.objectContaining({ code: 'file_tasks_pending' }));
  expect(await restored.blockers('unrelated')).toEqual([]);
});

it('预检保留原工作区根配置，复验配置并阻止同步范围内提交', async () => {
  const action = actionFixture();
  const workspace = { ...ws, remoteDir: '~/linked-project' };
  const executor = { run: vi.fn(async () => action.plan) };
  const unrelated: Workspace[] = [];
  const store = {
    list: async () => [structuredClone(workspace), ...unrelated],
    get: async () => structuredClone(workspace),
  };
  const pool = {
    identity: async () => 'fixture-identity',
    resolveConnection: async () => ({
      cacheKey: 'fixture-key',
      alias: 'my-server',
      hostname: 'fixture-host',
      port: 22,
      username: 'fixture-user',
      authMode: 'key' as const,
      knownHosts: '',
      knownHostsFile: path.join(os.tmpdir(), 'known-hosts-fixture'),
    }),
    generation: () => 0,
  } as Pick<SshPool, 'identity' | 'resolveConnection' | 'generation'>;
  const browse = {
    context: async () => ({ ...action.context, workspace: structuredClone(workspace), identity: 'fixture-identity' }),
  };
  const preflights = createFilePreflights({ store, pool, browse, executor });
  const preview = await preflights.create(
    ws.id,
    action.context.info.id,
    { kind: 'move', source, destination },
    new AbortController().signal,
  );
  const saved = preflights.take(ws.id, preview.id);
  expect(saved.roots).toEqual([path.posix.join(remoteHome, 'linked-project')]);
  expect(saved.plan.roots).toEqual([root]);
  workspace.remoteDir = '~/changed-project';
  await expect(preflights.validate(saved)).rejects.toMatchObject({ code: 'target_changed' });
  workspace.remoteDir = '~/linked-project';
  const insideDestination = path.posix.join(root, 'target.py');
  executor.run.mockResolvedValue({ ...action.plan, destination: insideDestination });
  const affected = await preflights.create(
    ws.id,
    action.context.info.id,
    { kind: 'move', source, destination: insideDestination },
    new AbortController().signal,
  );
  expect(affected.canSubmit).toBe(false);
  expect(affected.affectedWorkspaces.map((item) => item.id)).toEqual([ws.id]);
  expect(() => preflights.take(ws.id, affected.id)).toThrow('同步');
  const serverOnly = path.posix.join(root, 'data:2026.bin');
  executor.run.mockResolvedValue({
    ...action.plan,
    source: serverOnly,
    sourceFacts: ['1', '2', '33188', String(1024 ** 3), '5', '6'],
  });
  const unmanaged = await preflights.create(
    ws.id,
    action.context.info.id,
    { kind: 'move', source: serverOnly, destination },
    new AbortController().signal,
  );
  expect(unmanaged.canSubmit).toBe(true);
  expect(unmanaged.affectedWorkspaces).toEqual([]);
  unrelated.push({ ...workspace, id: 'unrelated', remoteDir: '~/unrelated-project' });
  await expect(preflights.validate(saved)).rejects.toMatchObject({ code: 'stale_preflight' });
  await expect(preflights.validate(saved, false)).resolves.toBeUndefined();
});

it('重复提交只创建一个已持久化任务，执行仍传入原始配置根', async () => {
  const fixture = await tasksFixture(async (_target, input, options) => {
    const files = await readdir(fixture.dir);
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(1);
    expect(input.roots).toEqual(fixture.action.roots);
    await options?.onPhase?.({ phase: 'renaming' });
    return { completed: true };
  });
  const [first, second] = await Promise.all([
    fixture.tasks.submit(ws.id, fixture.action.public.id),
    fixture.tasks.submit(ws.id, fixture.action.public.id),
  ]);
  expect(first.id).toBe(second.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, first.id)).phase).toBe('completed'));
  expect(fixture.executor.run).toHaveBeenCalledOnce();
  expect((await fixture.tasks.submit(ws.id, fixture.action.public.id)).id).toBe(first.id);
  await expect(fixture.tasks.status('other-workspace', first.id)).rejects.toMatchObject({ code: 'task_missing' });
});

it('首次阶段前断线保留待核对，核对同文件系统移动后确认结果而不重放', async () => {
  const fixture = await tasksFixture(async () => {
    throw new Error('连接中断');
  });
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('needs_check'));
  fixture.executor.run.mockResolvedValue({
    source: { exists: false },
    destination: {
      exists: true,
      type: 'file',
      facts: [...fixture.action.plan.sourceFacts!.slice(0, 5), 'changed-ctime'],
    },
  });
  expect((await fixture.tasks.check(ws.id, task.id)).phase).toBe('completed');
  expect(fixture.executor.run.mock.calls[1]?.[1].action).toBe('check');
});

it('取消已派发但未返回首阶段的操作不能声称回滚', async () => {
  const fixture = await tasksFixture(
    async (_target, _input, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new Error('执行已取消')), { once: true });
      }),
  );
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await vi.waitFor(() => expect(fixture.executor.run).toHaveBeenCalledOnce());
  await fixture.tasks.cancel(ws.id, task.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('needs_check'));
});

it('排队后配置改变会拒绝执行，不误标远端已经修改', async () => {
  const fixture = await tasksFixture(async () => ({ completed: true }));
  vi.mocked(fixture.preflights.validate)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new RemoteFilesError('target_changed'));
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('failed'));
  expect(fixture.executor.run).not.toHaveBeenCalled();
});

it('当前记录重启不重放未完成操作，目标存在不能冒充复制完成', async () => {
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const fixture = await tasksFixture(async () => {
    dispatched();
    throw new Error('中断');
  });
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  // 等待实际派发和持久化收尾，不依赖Windows磁盘在默认1秒轮询内完成。
  await started;
  await fixture.tasks.dispose();
  expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('needs_check');
  const file = path.join(fixture.dir, task.id + '.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.task.phase = 'copying';
  record.task.kind = 'copy';
  record.action.public.kind = 'copy';
  record.action.plan.kind = 'copy';
  await writeFile(file, JSON.stringify(record));
  const executor = { run: vi.fn(async () => ({ destination: { exists: true } })) };
  const restored = createFileTasks({ ...fixture.deps, executor });
  cleanups.push(() => restored.dispose());
  const listed = await restored.list(ws.id);
  expect(listed).toHaveLength(1);
  expect(listed[0]?.phase).toBe('needs_check');
  expect(executor.run).not.toHaveBeenCalled();
  expect((await restored.check(ws.id, task.id)).phase).toBe('needs_check');
});

it.each(['mkdir', 'delete'] as const)('%s正式空路径记录在重启后仍可读取且不重放', async (kind) => {
  const action = actionFixture();
  action.public.kind = kind;
  action.plan.kind = kind;
  const missing = kind === 'mkdir' ? 'source' : 'destination';
  delete action.public[missing];
  // Python处理器对不存在的操作端输出null，公开任务字段则省略。
  action.plan[missing] = null;
  const fixture = await tasksFixture(async () => ({ completed: true }), action);
  const task = await fixture.tasks.submit(ws.id, action.public.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('completed'));
  await fixture.tasks.dispose();
  const file = path.join(fixture.dir, task.id + '.json');
  const original = await readFile(file, 'utf8');
  const executor = { run: vi.fn() };
  const restored = createFileTasks({ ...fixture.deps, executor });
  cleanups.push(() => restored.dispose());
  expect(await restored.status(ws.id, task.id)).toMatchObject({ kind, phase: 'completed' });
  expect(await restored.blockers(ws.id)).toEqual([]);
  expect(executor.run).not.toHaveBeenCalled();
  expect(await readFile(file, 'utf8')).toBe(original);
});

it.each(['syncRequired', 'dispatched', 'id', 'identity', 'json', 'read'])('%s损坏拒绝', async (kind) => {
  const fixture = await tasksFixture(async () => ({ completed: true }));
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await fixture.tasks.dispose();
  const file = path.join(fixture.dir, task.id + '.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (kind === 'syncRequired') delete record.task.syncRequired;
  if (kind === 'dispatched') delete record.dispatched;
  if (kind === 'id') record.task.id = randomUUID();
  if (kind === 'identity') record.action.context.info.workspaceId = 'other';
  const text = kind === 'json' ? '{private-secret' : JSON.stringify(record);
  await writeFile(file, text, 'utf8');
  if (kind === 'read') {
    await rm(file);
    await mkdir(file);
  }
  const executor = { run: vi.fn() };
  const restored = createFileTasks({ ...fixture.deps, executor });
  cleanups.push(() => restored.dispose());
  // 让启动读取先失败，再调用入口；不能产生未处理的ready拒绝。
  await new Promise((resolve) => setTimeout(resolve, 30));
  for (const operation of [
    () => restored.list(ws.id),
    () => restored.status(ws.id, task.id),
    () => restored.cancel(ws.id, task.id),
    () => restored.check(ws.id, task.id),
    () => restored.recover(ws.id, task.id),
    () => restored.submit(ws.id, randomUUID()),
    () => restored.blockers(ws.id),
    () => restored.blockers('other'),
  ]) {
    await expect(operation()).rejects.toMatchObject({ code: 'task_storage_error' });
    await expect(operation()).rejects.not.toThrow('private-secret');
    if (kind !== 'read') expect(await readFile(file, 'utf8')).toBe(text);
  }
  expect(executor.run).not.toHaveBeenCalled();
  await expect(restored.dispose()).resolves.toBeUndefined();
});

it('任务目录非ENOENT读取失败阻止新任务和工作区移除', async () => {
  const fixture = await tasksFixture(async () => ({ completed: true }));
  await fixture.tasks.dispose();
  await writeFile(fixture.dir, 'private-secret', 'utf8');
  const restored = createFileTasks(fixture.deps);
  cleanups.push(() => restored.dispose());
  await expect(restored.list(ws.id)).rejects.toMatchObject({ code: 'task_storage_error' });
  await expect(restored.submit(ws.id, randomUUID())).rejects.toMatchObject({ code: 'task_storage_error' });
  await expect(restored.blockers(ws.id)).rejects.toMatchObject({ code: 'task_storage_error' });
  expect(await readFile(fixture.dir, 'utf8')).toBe('private-secret');
});

it('同设备移动退化为复制时使用已保存的正文证明核对，不依赖旧 inode', async () => {
  const proof = 'b'.repeat(64);
  const fixture = await tasksFixture(async (_target, _input, options) => {
    await options?.onPhase?.({ phase: 'verifying', verified: proof });
    throw new Error('删除源后断线');
  });
  const task = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('needs_check'));
  fixture.executor.run.mockResolvedValue({
    source: { exists: false },
    destination: { exists: true, contentDigest: proof },
  });
  // needs_check先更新内存再持久化，活动控制器收尾前check只返回状态；等可核对后保留同一结果断言。
  await vi.waitFor(async () => expect((await fixture.tasks.check(ws.id, task.id)).phase).toBe('completed'));
  expect(fixture.executor.run.mock.calls[1]?.[1].verifyContent).toBe(true);
});

it('相交路径排队，取消尚未派发的任务不执行远端，也不取消前一任务', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await tasksFixture(async () => {
    await gate;
    return { completed: true };
  });
  const first = await fixture.tasks.submit(ws.id, fixture.action.public.id);
  await vi.waitFor(() => expect(fixture.executor.run).toHaveBeenCalledOnce());
  const secondAction = structuredClone(fixture.action);
  secondAction.public.id = randomUUID();
  vi.mocked(fixture.preflights.take).mockReturnValue(secondAction);
  const second = await fixture.tasks.submit(ws.id, secondAction.public.id);
  await fixture.tasks.cancel(ws.id, second.id);
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, second.id)).phase).toBe('cancelled'));
  expect(fixture.executor.run).toHaveBeenCalledOnce();
  release();
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, first.id)).phase).toBe('completed'));
});

it('HTTP 提交必须绑定确认预检，未知字段拒绝执行，查询与核对受工作区限制', async () => {
  const fixture = await tasksFixture(async () => {
    throw new Error('结果未知');
  });
  const app = Fastify();
  cleanups.push(() => app.close());
  registerRemoteFileActionRoutes(app, {
    tasks: fixture.tasks,
    preflights: fixture.preflights,
    downloads: {} as FileDownloads,
  });
  const base = `/api/workspaces/${ws.id}/remote-files/tasks`;
  for (const payload of [
    { preflightId: fixture.action.public.id },
    { preflightId: fixture.action.public.id, confirmed: true, command: 'arbitrary' },
  ]) {
    expect((await app.inject({ method: 'POST', url: base, payload })).statusCode).toBe(400);
  }
  expect(fixture.executor.run).not.toHaveBeenCalled();
  const response = await app.inject({
    method: 'POST',
    url: base,
    payload: { preflightId: fixture.action.public.id, confirmed: true },
  });
  expect(response.statusCode).toBe(200);
  const task = response.json<{ id: string }>();
  await vi.waitFor(async () => expect((await fixture.tasks.status(ws.id, task.id)).phase).toBe('needs_check'));
  expect((await app.inject(base)).json().tasks).toHaveLength(1);
  expect((await app.inject(`${base}/${task.id}`)).statusCode).toBe(200);
  expect((await app.inject(`/api/workspaces/other/remote-files/tasks/${task.id}`)).statusCode).toBe(404);
  fixture.executor.run.mockResolvedValue({ source: { exists: true }, destination: { exists: false } });
  expect((await app.inject({ method: 'POST', url: `${base}/${task.id}/check`, payload: {} })).json().phase).toBe(
    'needs_check',
  );
  expect((await app.inject({ method: 'POST', url: `${base}/${task.id}/cancel`, payload: {} })).statusCode).toBe(200);
});
