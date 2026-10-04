import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { fileSyncFixture, fixtureWorkspace } from '../helpers/file-sync';
import { createSyncManager } from '../../src/sync/manager';
import { createFileSyncCoordinator } from '../../src/remote-files/sync-coordinator';
import { createFilePreflights } from '../../src/remote-files/preflight';
import { createFileTasks } from '../../src/remote-files/tasks';
import type { RemoteExecutor } from '../../src/remote-files/executor';
import type { SshPool } from '../../src/ssh/pool';
import { registerRemoteFileActionRoutes } from '../../src/http/remote-file-actions.routes';
import type { FileDownloads } from '../../src/remote-files/downloads';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-sync-core-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const first = await fixtureWorkspace(directory, 'a');
  const second = await fixtureWorkspace(directory, 'b');
  const workspaces = [second, first];
  const configDir = path.join(directory, 'config');
  const fixture = fileSyncFixture();
  let sync = createSyncManager({ configDir, driver: fixture.driver });
  const store = {
    get: async (id: string) => workspaces.find((workspace) => workspace.id === id),
    list: async () => workspaces,
  };
  const pool = {
    identity: async () => 'fixture-identity',
    resolveConnection: async () => ({ cacheKey: 'fixture-connection' }),
    generation: () => 0,
  } as unknown as Pick<SshPool, 'identity' | 'resolveConnection' | 'generation'>;
  let executions = 0;
  const executor: RemoteExecutor = {
    async run(_target, input) {
      if (input.action === 'execute') {
        executions++;
        const content = fixture.remote.get(input.source!)!;
        fixture.remote.delete(input.source!);
        fixture.remote.set(input.destination!, content);
        return { completed: true };
      }
      return {
        kind: input.kind,
        roots: input.roots,
        source: input.source,
        destination: input.destination,
        sourceType: 'file',
        sourceFacts: ['1', '2', '33188', '4', '5', '6'],
        entries: 1,
        files: 1,
        bytes: 4,
        crossFilesystem: false,
        sourceEntries: [{ path: '', type: 'file', size: 4 }],
      };
    },
  };
  const preflights = createFilePreflights({
    store,
    pool,
    executor,
    syncAvailable: true,
    syncPaths: (...args) => sync.remoteFiles.checkPaths(...args),
    browse: {
      context: async () => ({
        identity: 'fixture-identity',
        workspace: first,
        key: 'fixture-connection',
        generation: 0,
        info: {
          id: randomUUID(),
          workspaceId: first.id,
          sshHost: first.sshHost,
          home: path.posix.sep,
          root: first.remoteDir,
        },
      }),
    },
  });
  const order: string[] = [];
  const coordinator = () =>
    createFileSyncCoordinator({
      store,
      sync: {
        ...sync,
        transaction: (workspace, operation) => {
          order.push(workspace.id);
          return sync.transaction(workspace, operation);
        },
      },
      editors: { reserve: async () => () => undefined },
    });
  let tasks = createFileTasks({ configDir, preflights, executor, coordinator: coordinator() });
  cleanups.push(async () => {
    await tasks.dispose();
    sync.dispose();
  });
  async function submit(source: string, destination: string) {
    const preview = await preflights.create(
      first.id,
      randomUUID(),
      { kind: 'move', source, destination },
      new AbortController().signal,
    );
    return tasks.submit(first.id, preview.id);
  }
  async function restart() {
    await tasks.dispose();
    sync.dispose();
    sync = createSyncManager({ configDir, driver: fixture.driver });
    tasks = createFileTasks({ configDir, preflights, executor, coordinator: coordinator() });
  }
  return {
    ...fixture,
    directory,
    configDir,
    first,
    second,
    workspaces,
    order,
    submit,
    restart,
    sync: () => sync,
    tasks: () => tasks,
    executions: () => executions,
    preflights,
  };
}

it('跨工作区按固定锁序迁移；随后普通同步不会重新上传旧路径', async () => {
  const fixture = await setup();
  const source = path.posix.join(fixture.first.remoteDir, 'old.py');
  const destination = path.posix.join(fixture.second.remoteDir, 'new.py');
  fixture.remote.set(source, 'code');
  for (const workspace of [fixture.first, fixture.second]) await fixture.sync().sync(workspace);
  fixture.uploads.length = 0;
  const task = await fixture.submit(source, destination);
  await vi.waitFor(async () =>
    expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('completed'),
  );
  expect(fixture.order).toEqual(['a', 'b']);
  await expect(readFile(path.join(fixture.first.localDir, 'old.py'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(fixture.second.localDir, 'new.py'), 'utf8')).toBe('code');
  for (const workspace of [fixture.first, fixture.second]) await fixture.sync().sync(workspace);
  expect(fixture.remote.has(source)).toBe(false);
  expect(fixture.remote.get(destination)).toBe('code');
  expect(fixture.uploads).not.toContain(source);
  expect(fixture.executions()).toBe(1);
});

it('同步失败持久阻断，重启及新增无关工作区后确认恢复不重放远端操作', async () => {
  const fixture = await setup();
  const source = path.posix.join(fixture.first.remoteDir, 'old.py');
  const destination = path.posix.join(path.posix.sep, 'outside', 'new.py');
  fixture.remote.set(source, 'code');
  await fixture.sync().sync(fixture.first);
  fixture.controls.failPull = true;
  const task = await fixture.submit(source, destination);
  await vi.waitFor(async () =>
    expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('sync_pending'),
  );
  expect(await fixture.sync().sync(fixture.first)).toMatchObject({ reason: 'recovery' });
  await fixture.restart();
  fixture.workspaces.push(await fixtureWorkspace(fixture.directory, 'unrelated'));
  fixture.controls.failPull = false;
  const app = Fastify();
  cleanups.push(() => app.close());
  registerRemoteFileActionRoutes(app, {
    preflights: fixture.preflights,
    tasks: fixture.tasks(),
    downloads: {} as FileDownloads,
  });
  const url = `/api/workspaces/${fixture.first.id}/remote-files/tasks/${task.id}/recover`;
  for (const payload of [{}, { confirmed: false }, { confirmed: true, replay: true }])
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url, payload: { confirmed: true } })).statusCode).toBe(200);
  await vi.waitFor(async () =>
    expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('completed'),
  );
  await fixture.sync().sync(fixture.first);
  expect(fixture.remote.has(source)).toBe(false);
  expect(fixture.remote.get(destination)).toBe('code');
  expect(fixture.executions()).toBe(1);
});

it.each(['external edit', 'x'.repeat(65)])(
  '执行期间外部修改（%s）保留为冲突，移入大文件和权重不落入本地',
  async (external) => {
    const fixture = await setup();
    const old = path.posix.join(fixture.first.remoteDir, 'old.py');
    fixture.remote.set(old, 'code');
    await fixture.sync().sync(fixture.first);
    const id = randomUUID();
    await fixture.sync().transaction(fixture.first, async () => {
      await fixture.sync().remoteFiles.prepare(fixture.first, id);
      await writeFile(path.join(fixture.first.localDir, 'old.py'), external);
      fixture.remote.delete(old);
      fixture.remote.set(path.posix.join(fixture.first.remoteDir, 'new.py'), 'new');
      fixture.remote.set(path.posix.join(fixture.first.remoteDir, 'weights.pt'), 'excluded');
      fixture.remote.set(path.posix.join(fixture.first.remoteDir, 'large.txt'), 'x'.repeat(65));
      expect(await fixture.sync().remoteFiles.finish(fixture.first, id)).toMatchObject({ phase: 'conflicts' });
    });
    expect(await readFile(path.join(fixture.first.localDir, 'old.py'), 'utf8')).toBe(external);
    expect(await readFile(path.join(fixture.first.localDir, 'new.py'), 'utf8')).toBe('new');
    const files = await readdir(fixture.first.localDir);
    expect(files).not.toContain('weights.pt');
    expect(files).not.toContain('large.txt');
    const status = await fixture.sync().status(fixture.first);
    const localCopy = status.conflicts[0]!.localCopy;
    expect(await readFile(path.join(fixture.first.localDir, localCopy), 'utf8')).toBe(external);
    expect(await fixture.sync().sync(fixture.first)).toMatchObject({ phase: 'conflicts' });
  },
);

it('既有远端文件和本地空目录的大小写别名在派发前拒绝', async () => {
  const fixture = await setup();
  fixture.remote.set(path.posix.join(fixture.first.remoteDir, 'Foo.py'), 'code');
  const signal = new AbortController().signal;
  await expect(fixture.sync().remoteFiles.checkPaths(fixture.first, ['foo.py'], signal)).rejects.toMatchObject({
    code: 'case_collision',
  });
  await mkdir(path.join(fixture.first.localDir, 'Tree'));
  await expect(fixture.sync().remoteFiles.checkPaths(fixture.first, ['tree/code.py'], signal)).rejects.toMatchObject({
    code: 'case_collision',
  });
  expect(fixture.executions()).toBe(0);
});

it('取消单独的同步恢复保留阻断，再次恢复不重放', async () => {
  const fixture = await setup();
  const source = path.posix.join(fixture.first.remoteDir, 'old.py');
  const destination = path.posix.join(path.posix.sep, 'outside', 'new.py');
  fixture.remote.set(source, 'code');
  await fixture.sync().sync(fixture.first);
  fixture.controls.failPull = true;
  const task = await fixture.submit(source, destination);
  await vi.waitFor(async () =>
    expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('sync_pending'),
  );
  fixture.controls.failPull = false;
  let pulling = false;
  let finishCancellation: (() => void) | undefined;
  fixture.controls.pull = (signal) =>
    new Promise((_resolve, reject) => {
      pulling = true;
      signal.addEventListener(
        'abort',
        () => {
          finishCancellation = () => reject(new Error('fixture_cancelled'));
        },
        { once: true },
      );
    });
  await fixture.tasks().recover(fixture.first.id, task.id);
  await vi.waitFor(() => expect(pulling).toBe(true));
  await fixture.tasks().cancel(fixture.first.id, task.id);
  // 在取消仍清理传输时立即重试，不能把这次明确的恢复请求静默吞掉。
  const retry = fixture.tasks().recover(fixture.first.id, task.id);
  fixture.controls.pull = undefined;
  finishCancellation!();
  await retry;
  await vi.waitFor(async () =>
    expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('completed'),
  );
  expect(fixture.executions()).toBe(1);
});

it('恢复初始化持久化期间退出，会等待恢复收尾，退出返回后任务记录不再变化', async () => {
  const fixture = await setup();
  const source = path.posix.join(fixture.first.remoteDir, 'old.py');
  fixture.remote.set(source, 'code');
  await fixture.sync().sync(fixture.first);
  fixture.controls.failPull = true;
  const task = await fixture.submit(source, path.posix.join(path.posix.sep, 'outside', 'new.py'));
  await vi.waitFor(async () =>
    expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('sync_pending'),
  );
  await fixture.restart();
  const initializing = fixture.tasks().recover(fixture.first.id, task.id);
  // 同一 ready 屏障后，recover 已开始写入 checking，但初始化持久化尚未完成。
  expect((await fixture.tasks().status(fixture.first.id, task.id)).phase).toBe('checking');
  await fixture.tasks().dispose();
  const stopped = await fixture.tasks().status(fixture.first.id, task.id);
  await initializing;
  await fixture.tasks().dispose();
  expect(await fixture.tasks().status(fixture.first.id, task.id)).toEqual(stopped);
  expect(stopped.phase).toBe('sync_pending');
  expect(fixture.executions()).toBe(1);
});
