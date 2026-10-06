import { z } from 'zod';
import { WorkspaceInputSchema } from '@ssh-server/shared';
import { RemoteActionPlanSchema } from './executor';

const text = z.string().min(1).max(16_384);
const action = z.object({
  kind: z.enum(['mkdir', 'rename', 'move', 'copy', 'delete']),
  source: text.optional(),
  destination: text.optional(),
});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const node = z.object({
  exists: z.boolean(),
  type: z.enum(['file', 'directory', 'link']).optional(),
  facts: z.array(z.string()).length(6).optional(),
  treeDigest: digest.optional(),
  contentDigest: digest.optional(),
});
export const ResultCheckSchema = z.object({ source: node.optional(), destination: node.optional() });
export const TaskRecordSchema = z
  .object({
    task: action.extend({
      id: z.string().uuid(),
      workspaceId: text,
      preflightId: z.string().uuid(),
      sshHost: text,
      phase: z.enum([
        'queued',
        'checking',
        'creating',
        'renaming',
        'copying',
        'verifying',
        'removing_source',
        'completed',
        'cancelled',
        'failed',
        'needs_check',
        'sync_pending',
      ]),
      createdAt: z.number().finite(),
      updatedAt: z.number().finite(),
      cancelRequested: z.boolean(),
      remoteCompleted: z.boolean(),
      syncCompleted: z.boolean(),
      syncRequired: z.boolean(),
      message: z.string().optional(),
      resultCheck: ResultCheckSchema.optional(),
    }),
    action: z.object({
      public: action.extend({
        id: z.string().uuid(),
        workspaceId: text,
        sshHost: text,
        expiresAt: z.number().finite(),
        sourceType: z.enum(['file', 'directory', 'link', 'other']).optional(),
        entries: z.number().int().nonnegative(),
        files: z.number().int().nonnegative(),
        bytes: z.number().nonnegative(),
        crossFilesystem: z.boolean(),
        affectedWorkspaces: z.array(z.object({ id: text, name: text, remoteRoot: text })),
        warnings: z.array(z.string()),
        canSubmit: z.boolean(),
      }),
      context: z.object({
        workspace: WorkspaceInputSchema.extend({ id: text }),
        info: z.object({ id: z.string().uuid(), workspaceId: text, sshHost: text, root: text, home: text }),
        key: text,
        generation: z.number().int().nonnegative(),
      }),
      plan: RemoteActionPlanSchema,
      roots: z.array(text),
      identity: digest,
      configurations: z.array(z.object({ id: text, key: text })),
    }),
    verified: digest.optional(),
    dispatched: z.boolean(),
  })
  .superRefine((value, context) => {
    const { task, action } = value;
    const identities = [
      [task.workspaceId, action.public.workspaceId, action.context.workspace.id, action.context.info.workspaceId],
      [task.sshHost, action.public.sshHost, action.context.workspace.sshHost, action.context.info.sshHost],
      [task.preflightId, action.public.id],
      [task.kind, action.public.kind, action.plan.kind],
      [task.source, action.public.source, action.plan.source ?? undefined],
      [task.destination, action.public.destination, action.plan.destination ?? undefined],
    ];
    if (identities.some((values) => new Set(values).size !== 1))
      context.addIssue({ code: 'custom', message: '任务记录身份不一致' });
  });
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

/** 核对只确认有证据的结果；目标存在本身不能证明复制或新建完整。 */
export function confirmedResult(record: z.infer<typeof TaskRecordSchema>, result: z.infer<typeof ResultCheckSchema>) {
  const { kind } = record.task;
  if (kind === 'delete') return result.source?.exists === false;
  if (kind === 'copy') return verifiedCopy(record, result);
  if (kind !== 'move' && kind !== 'rename') return false;
  return confirmedMove(record, result);
}

function confirmedMove(record: z.infer<typeof TaskRecordSchema>, result: z.infer<typeof ResultCheckSchema>) {
  if (result.source?.exists !== false || !result.destination?.exists) return false;
  if (record.verified || record.action.plan.crossFilesystem) return verifiedCopy(record, result);
  return sameObject(result.destination.facts, record.action.plan.sourceFacts);
}

function verifiedCopy(record: z.infer<typeof TaskRecordSchema>, result: z.infer<typeof ResultCheckSchema>) {
  return !!record.verified && result.destination?.contentDigest === record.verified;
}
function sameObject(actual: string[] | undefined, expected: string[] | undefined) {
  return !!actual && !!expected && actual.slice(0, 5).join(',') === expected.slice(0, 5).join(',');
}
