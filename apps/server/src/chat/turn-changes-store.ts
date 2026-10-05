import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema, type TurnChangesRecord, type TurnSnapshot } from '@ssh-server/shared';
import { sha256 } from '../vcs/repository';
import { SessionError } from './sessions';

const Snapshot = z
  .object({
    turnId: z.uuid(),
    edge: z.enum(['base', 'result']),
    tree: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    repositoryId: z.string().regex(/^[a-f0-9]{64}$/),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().int().nonnegative(),
    excluded: z
      .array(z.object({ path: z.string().min(1).max(4096), reason: z.string().max(500) }).strict())
      .max(10_000),
  })
  .strict();
const Record = z
  .object({
    turnId: z.uuid(),
    agent: AgentKindSchema,
    sessionId: NativeSessionIdSchema.optional(),
    startedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().optional(),
    phase: z.enum(['running', 'complete', 'incomplete', 'unavailable']),
    message: z.string().max(500).optional(),
    changes: z
      .array(
        z
          .object({
            path: z.string().min(1).max(4096),
            kind: z.enum(['added', 'modified', 'deleted']),
            additions: z.number().int().nonnegative().nullable(),
            deletions: z.number().int().nonnegative().nullable(),
            binary: z.boolean(),
          })
          .strict(),
      )
      .max(10_000),
    excluded: z
      .array(z.object({ path: z.string().min(1).max(4096), reason: z.string().max(500) }).strict())
      .max(10_000)
      .optional(),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    base: Snapshot.optional(),
    result: Snapshot.optional(),
  })
  .strict();
const Records = z.array(Record).max(20);
export type StoredTurn = TurnChangesRecord & { binding: string; base?: TurnSnapshot; result?: TurnSnapshot };

/** 每工作区串行原子替换；损坏记录拒绝读取，不重放原生轮次。 */
export function createTurnChangesStore(configDir: string) {
  const directory = path.join(configDir, 'turn-changes');
  const cache = new Map<string, StoredTurn[]>();
  const queues = new Map<string, Promise<unknown>>();
  const filename = (id: string) => path.join(directory, `${sha256(id)}.json`);

  async function persist(id: string, records: StoredTurn[]): Promise<void> {
    const validated = Records.parse(records);
    const text = `${JSON.stringify(validated)}\n`;
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new SessionError(413, 'changes_limit', '本轮记录超过保留上限');
    await mkdir(directory, { recursive: true });
    const temporary = `${filename(id)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
      await rename(temporary, filename(id));
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    cache.set(id, validated);
  }

  async function load(id: string): Promise<StoredTurn[]> {
    const existing = cache.get(id);
    if (existing) return existing;
    let handle;
    try {
      handle = await open(filename(id), 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let records: StoredTurn[];
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) throw new Error('记录过大');
      records = Records.parse(JSON.parse(await handle.readFile('utf8')));
    } catch {
      throw new SessionError(503, 'changes_corrupt', '本轮改动记录损坏，已保留原文件，未重跑轮次');
    } finally {
      await handle.close();
    }
    const recovered = records.map((record): StoredTurn =>
      record.phase === 'running'
        ? {
            ...record,
            phase: 'incomplete',
            completedAt: Date.now(),
            message: '后端重启前未完成采集；未重跑Agent或同步',
          }
        : record,
    );
    if (records.some((record) => record.phase === 'running')) await persist(id, recovered);
    else cache.set(id, recovered);
    return recovered;
  }

  function serial<T>(id: string, operation: (records: StoredTurn[]) => Promise<T>): Promise<T> {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => operation(await load(id)));
    queues.set(id, run);
    void run
      .finally(() => {
        if (queues.get(id) === run) queues.delete(id);
      })
      .catch(() => undefined);
    return run;
  }
  return { serial, persist };
}
