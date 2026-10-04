import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RemoteFileTask, RemoteFileTaskPhase } from '@ssh-server/shared';
import { workspaceTarget } from '../ssh/connection';
import { remoteFilesError, RemoteFilesError } from './errors';
import type { RemoteExecutor } from './executor';
import { createPathLocks } from './path-locks';
import type { FilePreflights, PreparedAction } from './preflight';
import { confirmedResult, ResultCheckSchema, TaskRecordSchema } from './task-record';

type Record = { task: RemoteFileTask; action: PreparedAction; verified?: string };
type Deps = {
  configDir: string;
  preflights: FilePreflights;
  executor: RemoteExecutor;
  onCorrupt?: (name: string) => void;
};
const runningPhases = new Set<RemoteFileTaskPhase>([
  'queued',
  'checking',
  'creating',
  'renaming',
  'copying',
  'verifying',
  'removing_source',
]);

/** 任务先持久化再执行；重新启动只核对旧结果，不自动重放远端写操作。 */
export function createFileTasks(deps: Deps) {
  const dir = path.join(deps.configDir, 'remote-file-tasks');
  const records = new Map<string, Record>();
  const controllers = new Map<string, AbortController>();
  const executions = new Set<Promise<void>>();
  const submissions = new Map<string, Promise<RemoteFileTask>>();
  const locks = createPathLocks();
  let disposed = false;
  let writes: Promise<unknown> = Promise.resolve();
  async function persist(record: Record) {
    const contents = JSON.stringify(record) + '\n';
    const operation = async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, record.task.id + '.json');
      const temp = file + '.tmp-' + randomUUID();
      await writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, file);
    };
    const run = writes.then(operation, operation);
    writes = run.catch(() => undefined);
    await run;
  }
  const ready = (async () => {
    for (const name of await readdir(dir).catch(() => [])) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      let record: Record;
      try {
        record = TaskRecordSchema.parse(JSON.parse(await readFile(path.join(dir, name), 'utf8')));
      } catch {
        // 保留原始损坏记录供恢复，其余任务仍可查询；绝不重放未知写操作。
        deps.onCorrupt?.(name);
        continue;
      }
      if (record.task.id + '.json' !== name) continue;
      if (runningPhases.has(record.task.phase)) {
        record.task.phase = 'needs_check';
        record.task.message = '本机服务已重新启动，旧操作不会重放；请核对实际结果。';
        record.task.updatedAt = Date.now();
        await persist(record);
      }
      records.set(record.task.id, record);
    }
  })();
  const get = (workspaceId: string, id: string) => {
    const record = records.get(id);
    if (!record || record.task.workspaceId !== workspaceId) throw new RemoteFilesError('task_missing');
    return record;
  };
  async function update(record: Record, values: Partial<RemoteFileTask>) {
    Object.assign(record.task, values, { updatedAt: Date.now() });
    await persist(record);
  }
  async function perform(record: Record, controller: AbortController) {
    const { action } = record;
    const paths = [action.public.source, action.public.destination].filter((value): value is string => !!value);
    let dispatched = false;
    try {
      await locks.run(action.identity, paths, controller.signal, async () => {
        if (disposed) controller.abort();
        controller.signal.throwIfAborted();
        await update(record, { phase: 'checking' });
        await deps.preflights.validate(action);
        controller.signal.throwIfAborted();
        // 调用执行器后，即使尚未收到首条阶段消息，也不能断言远端没有修改。
        dispatched = true;
        await deps.executor.run(
          workspaceTarget(action.context.workspace),
          { ...action.public, action: 'execute', roots: action.roots, expected: action.plan },
          {
            signal: controller.signal,
            timeoutMs: 60 * 60_000,
            onPhase: async ({ phase, verified }) => {
              if (verified) record.verified = verified;
              await update(record, { phase });
            },
          },
        );
        await update(record, {
          phase: 'completed',
          remoteCompleted: true,
          syncCompleted: true,
          message: '服务器操作已完成；没有传输文件正文到本机。',
        });
      });
    } catch (error) {
      const started = dispatched;
      const phase = started ? 'needs_check' : controller.signal.aborted ? 'cancelled' : 'failed';
      const message = started
        ? '操作已中止或结果未确认，部分文件可能已改变；请核对源与目标。'
        : remoteFilesError(error).message;
      await update(record, { phase, message }).catch(() => {
        record.task.phase = 'needs_check';
        record.task.message = '任务状态无法保存，请恢复本机配置目录后核对远端结果。';
      });
    } finally {
      controllers.delete(record.task.id);
    }
  }
  async function submit(workspaceId: string, preflightId: string) {
    await ready;
    if (disposed || controllers.size >= 64) throw new RemoteFilesError('too_many_tasks');
    const prior = [...records.values()].find(
      (record) => record.task.workspaceId === workspaceId && record.task.preflightId === preflightId,
    );
    if (prior) return { ...prior.task };
    const action = deps.preflights.take(workspaceId, preflightId);
    await deps.preflights.validate(action);
    const now = Date.now();
    const task: RemoteFileTask = {
      id: randomUUID(),
      workspaceId,
      preflightId,
      sshHost: action.public.sshHost,
      kind: action.public.kind,
      source: action.public.source,
      destination: action.public.destination,
      phase: 'queued',
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
      remoteCompleted: false,
      syncCompleted: false,
    };
    const record: Record = { task, action };
    await persist(record);
    records.set(task.id, record);
    const controller = new AbortController();
    controllers.set(task.id, controller);
    const execution = perform(record, controller);
    executions.add(execution);
    void execution.finally(() => executions.delete(execution)).catch(() => undefined);
    return { ...task };
  }
  return {
    submit(workspaceId: string, preflightId: string) {
      const key = JSON.stringify([workspaceId, preflightId]);
      const prior = submissions.get(key);
      if (prior) return prior.then((task) => ({ ...task }));
      const run = submit(workspaceId, preflightId);
      submissions.set(key, run);
      void run.finally(() => submissions.delete(key)).catch(() => undefined);
      return run;
    },
    async list(workspaceId: string) {
      await ready;
      return [...records.values()]
        .filter((record) => record.task.workspaceId === workspaceId)
        .sort((a, b) => b.task.createdAt - a.task.createdAt)
        .slice(0, 100)
        .map((record) => ({ ...record.task }));
    },
    async status(workspaceId: string, id: string) {
      await ready;
      return { ...get(workspaceId, id).task };
    },
    async cancel(workspaceId: string, id: string) {
      await ready;
      const record = get(workspaceId, id);
      const controller = controllers.get(id);
      if (controller) {
        await update(record, { cancelRequested: true });
        controller.abort(new RemoteFilesError('cancelled'));
      }
      return { ...record.task };
    },
    async check(workspaceId: string, id: string) {
      await ready;
      if (controllers.has(id)) return { ...get(workspaceId, id).task };
      const record = get(workspaceId, id);
      await deps.preflights.validate(record.action, false);
      const result = ResultCheckSchema.parse(
        await deps.executor.run(
          workspaceTarget(record.action.context.workspace),
          {
            ...record.action.public,
            action: 'check',
            roots: record.action.roots,
            verifyContent: !!record.verified,
          },
          { timeoutMs: 60 * 60_000 },
        ),
      );
      const complete = confirmedResult(record, result);
      await update(record, {
        resultCheck: result,
        ...(complete ? { phase: 'completed', remoteCompleted: true, syncCompleted: true } : {}),
        message: complete
          ? '已核对并确认服务器操作结果。'
          : '已读取源与目标，但没有足够证据确认完整完成；请按实际结果处理部分产物。',
      });
      return { ...record.task };
    },
    async dispose() {
      disposed = true;
      for (const controller of controllers.values()) controller.abort(new RemoteFilesError('cancelled'));
      await Promise.allSettled([...executions]);
      await writes;
    },
  };
}

export type FileTasks = ReturnType<typeof createFileTasks>;
