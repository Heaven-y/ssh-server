import { SessionError } from '../../chat/sessions';
import { managementObject as object, type ManagementBackend, type ManagementRecord } from './management-rpc';

const MAX_STEPS = 50_000;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 64;

function incomplete(): never {
  throw new SessionError(503, 'session_history_incomplete', 'Antigravity 历史未完整读取，请稍后重试。');
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function totalSteps(response: ManagementRecord, steps: unknown[]): number {
  const total = response.numTotalSteps ?? steps.length;
  if (!Number.isSafeInteger(total) || Number(total) < steps.length || Number(total) > MAX_STEPS) incomplete();
  return Number(total);
}

function addPage(steps: unknown[], page: ManagementRecord, total: number): void {
  const next = list(page.steps);
  if (!next.length || steps.length + next.length > total) incomplete();
  steps.push(...next);
}

function completeMetadata(response: ManagementRecord, trajectory: ManagementRecord): unknown[] {
  const metadata = list(trajectory.generatorMetadata);
  // 生成元数据分页不影响正文；未取得末页时隐藏上下文，不能把旧页贴到最新会话。
  return (response.numTotalGeneratorMetadata ?? metadata.length) === metadata.length ? metadata : [];
}

/** 原生分页只有 offset，没有 page size；同时限制页数、总步骤及累计正文大小。 */
export async function completeTrajectory(
  backend: ManagementBackend,
  response: ManagementRecord,
  signal?: AbortSignal,
): Promise<ManagementRecord> {
  const trajectory = object(response.trajectory);
  const steps = [...list(trajectory.steps)];
  const total = totalSteps(response, steps);
  let bytes = Buffer.byteLength(JSON.stringify(response));
  const deadline = Date.now() + 30_000;
  let pages = 0;
  if (bytes > MAX_BYTES) incomplete();
  while (steps.length < total) {
    signal?.throwIfAborted();
    if (++pages > MAX_PAGES || Date.now() >= deadline) incomplete();
    const page = await backend.request('GetCascadeTrajectorySteps', {
      cascadeId: trajectory.cascadeId,
      stepOffset: steps.length,
      trajectoryVerbosity: 'CLIENT_TRAJECTORY_VERBOSITY_FULL',
    });
    bytes += Buffer.byteLength(JSON.stringify(page));
    if (bytes > MAX_BYTES) incomplete();
    addPage(steps, page, total);
  }
  signal?.throwIfAborted();
  return { ...trajectory, steps, generatorMetadata: completeMetadata(response, trajectory) };
}
