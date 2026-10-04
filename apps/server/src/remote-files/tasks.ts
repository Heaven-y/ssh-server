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
import type { FileSyncCoordinator } from './sync-coordinator';

type Record = { task: RemoteFileTask; action: PreparedAction; verified?: string; dispatched?: boolean };
type Deps = {
  configDir: string;
  preflights: FilePreflights;
  executor: RemoteExecutor;
  coordinator?: FileSyncCoordinator;
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
  const settling = new Set<string>();
  const executions = new Map<string, Promise<unknown>>();
  const submissions = new Map<string, Promise<RemoteFileTask>>();
  const locks = createPathLocks();
  let disposed = false;
  let writes: Promise<unknown> = Promise.resolve();
  function trackExecution(id: string, execution: Promise<unknown>) {
    executions.set(id, execution);
    void execution
      .finally(() => {
        if (executions.get(id) === execution) executions.delete(id);
      })
      .catch(() => undefined);
  }
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
        record.task.phase = record.dispatched === false ? 'cancelled' : 'needs_check';
        record.task.message =
          record.dispatched === false
            ? '本机服务已重新启动，该操作未派发，不会重放；相关同步暂停可从任务恢复。'
            : '本机服务已重新启动，旧操作不会重放；请核对实际结果。';
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
  async function settle(record: Record, values: Partial<RemoteFileTask>) {
    settling.add(record.task.id);
    await update(record, values);
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
        const execute = async () => {
          await deps.preflights.validate(action);
          controller.signal.throwIfAborted();
          await persist({ ...record, dispatched: true });
          record.dispatched = true;
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
        };
        const remoteCompleted = () =>
          update(record, {
            remoteCompleted: true,
            phase: action.public.affectedWorkspaces.length ? 'sync_pending' : 'completed',
          });
        let syncCompleted = true;
        if (deps.coordinator) {
          syncCompleted = await deps.coordinator.run(record.task.id, action, controller.signal, {
            execute,
            remoteCompleted,
          });
        } else {
          if (action.public.affectedWorkspaces.length) throw new RemoteFilesError('sync_pending');
          await execute();
          await remoteCompleted();
        }
        await settle(record, {
          phase: syncCompleted ? 'completed' : 'sync_pending',
          remoteCompleted: true,
          syncCompleted,
          message: syncCompleted
            ? action.public.affectedWorkspaces.length
              ? '服务器操作与相关同步路径协调已完成；仅服务器文件正文未传输到本机。'
              : '服务器操作已完成；没有传输文件正文到本机。'
            : '服务器操作已完成，相关同步仍需处理冲突或恢复；不会重放服务器操作。',
        });
      });
    } catch (error) {
      const started = dispatched;
      const phase = record.task.remoteCompleted
        ? 'sync_pending'
        : started
          ? 'needs_check'
          : controller.signal.aborted
            ? 'cancelled'
            : 'failed';
      const message = record.task.remoteCompleted
        ? '服务器操作已完成，同步协调未完成；请从文件任务恢复，不会重新执行服务器操作。'
        : started
          ? '操作已中止或结果未确认，部分文件可能已改变；请核对源与目标。'
          : remoteFilesError(error).message;
      await settle(record, { phase, message }).catch(() => {
        record.task.phase = 'needs_check';
        record.task.message = '任务状态无法保存，请恢复本机配置目录后核对远端结果。';
      });
    } finally {
      controllers.delete(record.task.id);
      settling.delete(record.task.id);
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
      syncRequired: action.public.affectedWorkspaces.length > 0,
    };
    const record: Record = { task, action, dispatched: false };
    await persist(record);
    records.set(task.id, record);
    const controller = new AbortController();
    controllers.set(task.id, controller);
    const execution = perform(record, controller);
    trackExecution(task.id, execution);
    return { ...task };
  }
  async function restoreSync(record: Record, controller: AbortController) {
    try {
      controller.signal.throwIfAborted();
      await deps.preflights.validate(record.action, false);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60_000)]);
      const complete =
        record.dispatched === false
          ? await deps.coordinator!.abandon(record.task.id, record.action, signal)
          : await deps.coordinator!.recover(record.task.id, record.action, signal);
      await settle(record, {
        syncCompleted: complete,
        phase:
          record.dispatched === false && complete
            ? 'cancelled'
            : record.task.remoteCompleted
              ? complete
                ? 'completed'
                : 'sync_pending'
              : 'needs_check',
        message: complete
          ? '已按实际远端结果协调同步，服务器写操作没有重放；未确认的操作仍须核对。'
          : '远端操作没有重放，相关工作区仍有同步冲突或待处理事项。',
      });
      return { ...record.task };
    } catch (error) {
      await settle(record, {
        phase: record.task.remoteCompleted ? 'sync_pending' : record.dispatched === false ? 'failed' : 'needs_check',
        message: '同步恢复未完成，旧路径仍不会自动上传；请核对连接、编辑与冲突后重试。',
      }).catch(() => undefined);
      throw error;
    } finally {
      controllers.delete(record.task.id);
      settling.delete(record.task.id);
    }
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
      const requiresSync = complete && record.action.public.affectedWorkspaces.length > 0 && !record.task.syncCompleted;
      await update(record, {
        resultCheck: result,
        ...(complete
          ? { phase: requiresSync ? 'sync_pending' : 'completed', remoteCompleted: true, syncCompleted: !requiresSync }
          : {}),
        message: complete
          ? '已核对并确认服务器操作结果。'
          : '已读取源与目标，但没有足够证据确认完整完成；请按实际结果处理部分产物。',
      });
      return { ...record.task };
    },
    async recover(workspaceId: string, id: string) {
      await ready;
      const record = get(workspaceId, id);
      const active = controllers.get(id);
      // 终态先更新内存再持久化；取消或失败的尾部清理均须等待，不能吞掉明确恢复。
      if (active && (active.signal.aborted || settling.has(id))) await executions.get(id)?.catch(() => undefined);
      if (controllers.has(id)) return { ...record.task };
      if (!deps.coordinator || !record.action.public.affectedWorkspaces.length)
        throw new RemoteFilesError('sync_pending');
      if (disposed || controllers.size >= 64) throw new RemoteFilesError('too_many_tasks');
      const controller = new AbortController();
      controllers.set(id, controller);
      const initialization = update(record, { phase: 'checking', cancelRequested: false });
      // 初始化写盘也属于恢复生命周期，退出必须等待它及后续中止收尾。
      const execution = initialization
        .then(() => restoreSync(record, controller))
        .finally(() => {
          if (controllers.get(id) === controller) controllers.delete(id);
        });
      trackExecution(id, execution);
      await initialization;
      return { ...record.task };
    },
    async dispose() {
      disposed = true;
      for (const controller of controllers.values()) controller.abort(new RemoteFilesError('cancelled'));
      await Promise.allSettled(executions.values());
      await writes;
    },
  };
}

export type FileTasks = ReturnType<typeof createFileTasks>;
