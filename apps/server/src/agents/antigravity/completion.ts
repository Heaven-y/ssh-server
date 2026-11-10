import { managementObject as object, managementText as text, type ManagementRecord } from './management-rpc';
import type { AntigravitySessionManagement } from './session-management-types';

export type CompletionBoundary = { inputIndex: number; latestIndex: number };
export type TrajectoryReader = NonNullable<AntigravitySessionManagement['readTrajectory']>;
const DONE = 'CORTEX_STEP_STATUS_DONE';
const INPUT = 'CORTEX_STEP_TYPE_USER_INPUT';

function completedStep(step: ManagementRecord): boolean {
  if (step.status !== DONE || step.error || step.type === INPUT || step.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE')
    return false;
  const command = object(step.runCommand);
  return (
    command.userRejected !== true &&
    command.timedOut !== true &&
    !(typeof command.exitCode === 'number' && command.exitCode !== 0) &&
    object(step.mcpTool).userRejected !== true &&
    object(step.checkpoint).modelSummarizationFailed !== true
  );
}

function completedTrajectory(trajectory: ManagementRecord, sessionId: string, boundary: CompletionBoundary): boolean {
  if (trajectory.cascadeId !== sessionId || !Array.isArray(trajectory.steps)) return false;
  const steps: unknown[] = trajectory.steps;
  const input = object(steps[boundary.inputIndex]);
  if (input.type !== INPUT || input.status !== DONE || steps.length - 1 < boundary.latestIndex) return false;
  const current = steps.slice(boundary.inputIndex + 1).map(object);
  if (!current.length || !current.every(completedStep)) return false;
  const last = current.at(-1)!;
  const response = object(last.plannerResponse);
  return (
    last.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' &&
    !!(text(response.modifiedResponse) || text(response.response)).trim()
  );
}

/** 读取方已核对身份、目录和空闲状态；这里只认可与本轮输入边界一致的完整终态。 */
export async function verifyAntigravityCompletion(
  read: TrajectoryReader,
  input: { sessionId: string; cwd: string; boundary: CompletionBoundary },
  signal: AbortSignal,
): Promise<boolean> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  if (bounded.aborted) return false;
  let abort!: () => void;
  const cancelled = new Promise<false>((resolve) => {
    abort = () => resolve(false);
    bounded.addEventListener('abort', abort, { once: true });
  });
  try {
    const verified = Promise.resolve()
      .then(() => read(input.sessionId, input.cwd, bounded))
      .then(({ trajectory }) => completedTrajectory(trajectory, input.sessionId, input.boundary))
      .catch(() => false);
    return await Promise.race([verified, cancelled]);
  } finally {
    bounded.removeEventListener('abort', abort);
  }
}
