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
});
export type RemoteActionPlan = z.infer<typeof RemoteActionPlanSchema>;
export type HelperInput = RemoteFileActionInput & {
  action: 'plan' | 'execute' | 'check';
  roots: string[];
  expected?: RemoteActionPlan;
  verifyContent?: boolean;
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

async function consume(channel: ClientChannel, options: Options) {
  let pending = '';
  let result: unknown;
  const lineOf = async (line: string) => {
    const event = EventSchema.parse(JSON.parse(line));
    if (event.event === 'error') throw fileOperationError(event.code);
    if (event.event === 'phase') await options.onPhase?.(event);
    if (event.event === 'result') result = event.result;
  };
  for await (const raw of channel) {
    options.signal?.throwIfAborted();
    pending += Buffer.from(raw as Uint8Array).toString('utf8');
    if (pending.length > 65_536) throw new RemoteFilesError('operation_failed');
    let end: number;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (line) await lineOf(line);
    }
  }
  if (pending.trim() || result === undefined) throw new RemoteFilesError('operation_failed');
  return result;
}

/** 正文永不经过本机；只读取固定处理器的少量 JSON 状态，消费速度控制 SSH 输出。 */
export function createRemoteExecutor(pool: Pick<SshPool, 'openExec'>): RemoteExecutor {
  return {
    async run(target, input, options = {}) {
      const source = Buffer.from(await helperSource).toString('base64');
      const payload = Buffer.from(JSON.stringify(input)).toString('base64');
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
        const result = await consume(channel, { ...options, signal });
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
