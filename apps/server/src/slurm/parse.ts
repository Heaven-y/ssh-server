import type { SlurmSnapshot } from '@ssh-server/shared';
import { SLURM_LIMITS } from './commands';

// 对应固定 squeue 格式的右对齐列宽；不解释作业字段或依赖版本定义。
const HEADER = [
  'JOBID'.padStart(18),
  'PARTITION'.padStart(9),
  'NAME'.padStart(24),
  'USER'.padStart(8),
  'ST'.padStart(2),
  'TIME'.padStart(10),
  'NODES'.padStart(6),
  'NODELIST(REASON)',
].join(' ');

export function slurmFailure(status: 'unavailable' | 'error', message: string, sampledAt = Date.now()): SlurmSnapshot {
  return { sampledAt, status, output: '', truncated: false, message };
}

export function parseSlurmOutput(text: string, sampledAt = Date.now(), warning = false): SlurmSnapshot {
  if (Buffer.byteLength(text, 'utf8') > SLURM_LIMITS.outputBytes)
    return slurmFailure('error', 'Slurm 输出超过 512 KiB，已拒绝不完整结果', sampledAt);
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  // 只去掉末尾换行，不裁剪表格前导或尾部空格。
  while (lines.at(-1) === '') lines.pop();
  return {
    sampledAt,
    status: 'available',
    output: lines.length ? [HEADER, ...lines.slice(0, SLURM_LIMITS.lines)].join('\n') : '',
    truncated: lines.length > SLURM_LIMITS.lines,
    ...(warning ? { message: 'Slurm 返回警告，结果可能不完整' } : {}),
  };
}
