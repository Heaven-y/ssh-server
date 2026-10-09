import { terminalTargetKey, type SlurmSnapshot, type TerminalTarget } from '@ssh-server/shared';
import { createResourceTargetContext, ResourceTargetError, type ResourceTargetContext } from '../resources/target';
import { workspaceTarget } from '../ssh/connection';
import type { SshPool } from '../ssh/pool';
import type { WorkspaceStore } from '../workspaces/store';
import { abortable } from './abort';
import { querySlurm, SlurmQueryError, SLURM_LIMITS } from './commands';
import { parseSlurmOutput, slurmFailure } from './parse';

const CACHE_MS = 2000;
const CACHE_ENTRIES = 32;
type Entry = {
  controller: AbortController;
  pending: Promise<SlurmSnapshot>;
  users: number;
  done: boolean;
  expiresAt: number;
  snapshot?: SlurmSnapshot;
};
const failure = (error: unknown) =>
  error instanceof SlurmQueryError
    ? slurmFailure(error.status, error.message)
    : slurmFailure('error', 'Slurm 查询未完成，请检查 SSH 连接后重试');

export function createSlurmService({ store, pool }: { store: Pick<WorkspaceStore, 'get'>; pool: SshPool }) {
  const context = createResourceTargetContext({ store, pool });
  const entries = new Map<string, Entry>();
  const lifetime = new AbortController();

  async function load(target: TerminalTarget, expected: ResourceTargetContext, signal: AbortSignal) {
    const credentials = new AbortController();
    const detach = pool.onCredentialsChanged(target.sshHost, () =>
      credentials.abort(new ResourceTargetError('target_changed')),
    );
    const combined = AbortSignal.any([signal, credentials.signal]);
    try {
      const checked = await abortable(context(target, expected), combined);
      combined.throwIfAborted();
      let snapshot: SlurmSnapshot;
      try {
        const result = await querySlurm(pool, workspaceTarget(checked.workspace), combined);
        snapshot = parseSlurmOutput(result.stdout, Date.now(), result.warning);
      } catch (error) {
        combined.throwIfAborted();
        snapshot = failure(error);
      }
      // 即使是失败摘要也必须复验，旧连接结果不能进入任何目标的缓存。
      await abortable(context(target, expected), combined);
      combined.throwIfAborted();
      return snapshot;
    } finally {
      detach();
    }
  }
  function makeRoom() {
    for (const [key, entry] of entries) if (entry.done && entry.expiresAt <= Date.now()) entries.delete(key);
    if (entries.size < CACHE_ENTRIES) return;
    const oldest = [...entries].find(([, entry]) => entry.done);
    if (!oldest) throw new SlurmQueryError('error', 'Slurm 查询名额已满，请稍后手动重试');
    entries.delete(oldest[0]);
  }
  function start(key: string, target: TerminalTarget, expected: ResourceTargetContext): Entry {
    makeRoom();
    const controller = new AbortController();
    const entry: Entry = {
      controller,
      users: 0,
      done: false,
      expiresAt: 0,
      pending: load(target, expected, controller.signal)
        .then((snapshot) => {
          controller.signal.throwIfAborted();
          if (snapshot.status !== 'error') {
            entry.snapshot = snapshot;
            entry.expiresAt = Date.now() + CACHE_MS;
          }
          return snapshot;
        })
        .finally(() => {
          entry.done = true;
          if (!entry.snapshot && entries.get(key) === entry) entries.delete(key);
        }),
    };
    entries.set(key, entry);
    return entry;
  }
  async function wait(key: string, entry: Entry, signal: AbortSignal) {
    entry.users++;
    try {
      return await abortable(entry.pending, signal);
    } finally {
      entry.users--;
      if (!entry.done && entry.users === 0) {
        entry.controller.abort();
        if (entries.get(key) === entry) entries.delete(key);
      }
    }
  }
  async function read(target: TerminalTarget, signal: AbortSignal): Promise<SlurmSnapshot> {
    let key: string | undefined;
    try {
      const expected = await abortable(context(target), signal);
      signal.throwIfAborted();
      // 固定目标、实际连接及认证代次共同隔离，绝不向网页返回这些内部摘要。
      key = JSON.stringify([terminalTargetKey(target), expected.key, expected.samplingKey, expected.generation]);
      let entry = entries.get(key);
      if (!entry || (entry.done && entry.expiresAt <= Date.now())) entry = start(key, target, expected);
      const snapshot = entry.snapshot ?? (await wait(key, entry, signal));
      await abortable(context(target, expected), signal);
      signal.throwIfAborted();
      return structuredClone(snapshot);
    } catch (error) {
      if (error instanceof ResourceTargetError) {
        if (key) entries.delete(key);
        throw error;
      }
      signal.throwIfAborted();
      return failure(error);
    }
  }
  return {
    async get(target: TerminalTarget, signal: AbortSignal): Promise<SlurmSnapshot> {
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      const deadline = new AbortController();
      const timeout = new SlurmQueryError('error', 'Slurm 查询超时（8 秒），请手动重试');
      const timer = setTimeout(() => deadline.abort(timeout), SLURM_LIMITS.timeoutMs);
      const combined = AbortSignal.any([signal, lifetime.signal, deadline.signal]);
      try {
        return await read({ ...target }, combined);
      } catch (error) {
        signal.throwIfAborted();
        lifetime.signal.throwIfAborted();
        if (error === timeout) return failure(error);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    dispose() {
      lifetime.abort(new Error('Slurm 作业服务已关闭'));
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
    },
  };
}
export type SlurmService = ReturnType<typeof createSlurmService>;
