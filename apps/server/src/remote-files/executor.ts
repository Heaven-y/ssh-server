import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ClientChannel } from 'ssh2';
import type { RemoteFileActionInput } from '@ssh-server/shared';
import type { SshPool } from '../ssh/pool';
import type { SshTarget } from '../ssh/connection';
import { sq } from '../ssh/remote-command';
import { fileOperationError, RemoteFilesError } from './errors';

const facts = z.array(z.string()).length(6);
const parent = z.array(z.string()).length(3);
const SourceEntrySchema = z.object({
  path: z.string().max(4096),
  type: z.enum(['file', 'directory', 'link']),
  size: z.number().int().nonnegative(),
});
export const RemoteActionPlanSchema = z.object({
  kind: z.enum(['mkdir', 'rename', 'move', 'copy', 'delete']),
  roots: z.array(z.string()),
  source: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  entries: z.number().int().nonnegative().max(50_000),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sourceType: z.enum(['file', 'directory', 'link']).optional(),
  sourceFacts: facts.optional(),
  sourceDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  sourceParent: parent.optional(),
  destinationParent: parent.optional(),
  crossFilesystem: z.boolean(),
  sourceEntries: z.array(SourceEntrySchema).max(50_000).optional(),
});
export type RemoteActionPlan = z.infer<typeof RemoteActionPlanSchema>;
export type HelperInput = RemoteFileActionInput & {
  action: 'plan' | 'execute' | 'check';
  roots: string[];
  expected?: RemoteActionPlan;
  verifyContent?: boolean;
  includeEntries?: boolean;
};
const PhaseSchema = z.object({
  event: z.literal('phase'),
  phase: z.enum(['creating', 'renaming', 'copying', 'verifying', 'removing_source']),
  verified: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
const EventSchema = z.discriminatedUnion('event', [
  PhaseSchema,
  z.object({ event: z.literal('result'), result: z.unknown() }),
  z.object({ event: z.literal('error'), code: z.string() }),
  SourceEntrySchema.extend({ event: z.literal('entry') }),
]);
type Phase = Omit<z.infer<typeof PhaseSchema>, 'event'>;
type Options = { signal?: AbortSignal; timeoutMs?: number; onPhase?: (phase: Phase) => Promise<void> };
export type RemoteExecutor = {
  run(target: SshTarget, input: HelperInput, options?: Options): Promise<unknown>;
};

const helperSource = readFile(new URL('./remote-helper.py', import.meta.url), 'utf8');

function stopChannel(channel: ClientChannel) {
  try {
    channel.signal('TERM');
  } catch {
    /* 通道可能已经关闭，仍清理本地资源。 */
  }
  channel.close();
}

function collectEvents(options: Options, includeEntries: boolean) {
  let result: unknown;
  const entries: z.infer<typeof SourceEntrySchema>[] = [];
  let metadataBytes = 0;
  const lineOf = async (line: string) => {
    const event = EventSchema.parse(JSON.parse(line));
    if (event.event === 'error') throw fileOperationError(event.code);
    if (event.event === 'phase') await options.onPhase?.(event);
    if (event.event === 'result') result = event.result;
    if (event.event === 'entry') {
      metadataBytes += Buffer.byteLength(line);
      if (!includeEntries || entries.length >= 50_000 || metadataBytes > 2 * 1024 * 1024)
        throw new RemoteFilesError('scan_incomplete');
      entries.push({ path: event.path, type: event.type, size: event.size });
    }
  };
  return {
    lineOf,
    finish() {
      if (result === undefined) throw new RemoteFilesError('operation_failed');
      if (includeEntries && (result as { entries?: number }).entries !== entries.length)
        throw new RemoteFilesError('scan_incomplete');
      return includeEntries ? { ...(result as object), sourceEntries: entries } : result;
    },
  };
}

async function consume(channel: ClientChannel, options: Options, includeEntries = false) {
  let pending = '';
  const events = collectEvents(options, includeEntries);
  for await (const raw of channel) {
    options.signal?.throwIfAborted();
    pending += Buffer.from(raw as Uint8Array).toString('utf8');
    if (pending.length > 65_536) throw new RemoteFilesError('operation_failed');
    let end: number;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (line) await events.lineOf(line);
    }
  }
  if (pending.trim()) throw new RemoteFilesError('operation_failed');
  return events.finish();
}

/** 正文永不经过本机；只读取固定处理器的少量 JSON 状态，消费速度控制 SSH 输出。 */
export function createRemoteExecutor(pool: Pick<SshPool, 'openExec'>): RemoteExecutor {
  return {
    async run(target, input, options = {}) {
      const source = Buffer.from(await helperSource).toString('base64');
      // 清单仅用于本机影响分类；对象摘要已绑定完整树，不把大清单塞进 SSH 命令参数。
      const expected = input.expected ? { ...input.expected, sourceEntries: undefined } : undefined;
      const payload = Buffer.from(JSON.stringify({ ...input, expected })).toString('base64');
      const script = `import base64;exec(base64.b64decode('${source}'))`;
      const signal = AbortSignal.any([
        AbortSignal.timeout(options.timeoutMs ?? 30_000),
        ...(options.signal ? [options.signal] : []),
      ]);
      signal.throwIfAborted();
      const channel = await pool.openExec(target, `python3 -c ${sq(script)} ${sq(payload)}`, signal);
      let exitCode: number | undefined;
      const stop = () => stopChannel(channel);
      const closed = new Promise<void>((resolve, reject) => {
        channel.once('close', () => resolve());
        channel.once('error', reject);
      });
      void closed.catch(() => undefined);
      channel.on('exit', (code: number) => {
        exitCode = code;
      });
      channel.stderr.on('data', () => undefined);
      channel.on('error', () => undefined);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      try {
        const result = await consume(channel, { ...options, signal }, input.includeEntries);
        await closed;
        signal.throwIfAborted();
        if (exitCode !== 0) throw new RemoteFilesError('operation_failed');
        return result;
      } finally {
        signal.removeEventListener('abort', stop);
        channel.close();
      }
    },
  };
}
