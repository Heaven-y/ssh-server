import { parse } from 'csv-parse/sync';
import {
  RESOURCE_LIMITS,
  type ResourceDisk,
  type ResourceGpu,
  type ResourceHost,
  type ResourceProcess,
} from '@ssh-server/shared';

export type CpuCounters = { total: number; idle: number };
const clean = (value: string, limit: number) =>
  value
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, limit);
function numeric(value: string | undefined, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (!value?.trim() || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max ? result : null;
}
const bytes = (value: string | undefined, unit: number) => {
  const result = numeric(value);
  return result !== null && Number.isSafeInteger(result * unit) ? result * unit : null;
};
function csv(text: string): string[][] {
  try {
    return parse(text, { trim: true, skip_empty_lines: true, relax_column_count: true });
  } catch {
    return [];
  }
}
function sections(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  // eslint-disable-next-line no-control-regex -- 固定分节协议使用实际RS/US字节。
  const chunks = text.split(/\x1e([a-z]+)\x1f\r?\n/);
  for (let index = 1; index < chunks.length; index += 2) result[chunks[index]!] = chunks[index + 1]!.trim();
  return result;
}
function cpuCounters(text: string): CpuCounters | undefined {
  const values = text
    .trim()
    .split(/\s+/)
    .slice(1, 9)
    .map((value) => numeric(value));
  if (!text.startsWith('cpu ') || values.length < 4 || values.some((value) => value === null)) return;
  const counts = values as number[];
  const total = counts.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? { total, idle: counts[3]! + (counts[4] ?? 0) } : undefined;
}
function cpuUsage(current?: CpuCounters, previous?: CpuCounters): number | null {
  if (!current || !previous) return null;
  const total = current.total - previous.total;
  const idle = current.idle - previous.idle;
  return total > 0 && idle >= 0 && idle <= total ? (1 - idle / total) * 100 : null;
}
function gpuMetrics(text: string): ResourceGpu[] | null {
  const rows = csv(text);
  if (!rows.length) return null;
  const result = rows
    .filter((row) => row.length === 8 && numeric(row[0], 0, 65535) !== null && row[1]!.startsWith('GPU-'))
    .map((row) => ({
      index: Number(row[0]),
      uuid: clean(row[1]!, 200),
      name: clean(row[2]!, 200),
      utilization: numeric(row[3], 0, 100),
      memoryUsed: bytes(row[4], 1024 * 1024),
      memoryTotal: bytes(row[5], 1024 * 1024),
      temperature: numeric(row[6], -100, 250),
      power: numeric(row[7], 0, 10000),
    }));
  return result.length ? result : null;
}
function processes(text: string, gpuText: string): ResourceProcess[] | null {
  const gpuRows = csv(gpuText).slice(0, RESOURCE_LIMITS.gpuProcesses);
  const result: ResourceProcess[] = [];
  for (const line of text.split('\n').slice(0, RESOURCE_LIMITS.processes)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const pid = numeric(match[1], 1, 2147483647);
    if (pid === null) continue;
    const gpus = gpuRows
      .filter((row) => Number(row[0]) === pid && row[1]?.startsWith('GPU-'))
      .map((row) => ({
        uuid: clean(row[1]!, 200),
        memoryBytes: bytes(row[2], 1024 * 1024),
      }));
    result.push({
      pid,
      command: clean(match[4]!, 128),
      cpuPercent: numeric(match[2], 0, 100000),
      memoryBytes: bytes(match[3], 1024),
      gpus,
    });
  }
  return result.length ? result : null;
}

function loadMetrics(text: string): ResourceHost['load'] {
  const loadValues = text
    .split(/\s+/)
    .slice(0, 3)
    .map((value) => numeric(value));
  const load =
    loadValues.length === 3 && loadValues.every((value) => value !== null)
      ? (loadValues as [number, number, number])
      : null;
  return load;
}
function memoryMetrics(text: string) {
  const memory: Record<string, number | null> = Object.fromEntries(
    [...text.matchAll(/^(MemTotal|MemAvailable):\s+(\d+) kB$/gm)].map((match) => [match[1]!, bytes(match[2], 1024)]),
  );
  const total = memory.MemTotal ?? null;
  const available = memory.MemAvailable ?? null;
  const used = total !== null && available !== null && available <= total ? total - available : null;
  return { total, used };
}

export function parseHostResources(text: string, previousCpu?: CpuCounters): { data: ResourceHost; cpu?: CpuCounters } {
  const parts = sections(text);
  if (!Object.hasOwn(parts, 'done')) throw new Error('资源输出不完整');
  const cpu = cpuCounters(parts.cpu ?? '');
  const { total, used } = memoryMetrics(parts.memory ?? '');
  return {
    cpu,
    data: {
      hostname: clean(parts.host ?? '', 255) || null,
      cpuPercent: cpuUsage(cpu, previousCpu),
      load: loadMetrics(parts.load ?? ''),
      memoryTotal: total,
      memoryUsed: used,
      gpus: gpuMetrics(parts.gpu ?? ''),
      processes: processes(parts.process ?? '', parts.gpuprocess ?? ''),
      gpuProcessesAvailable: parts.gpustatus === '0',
    },
  };
}

export function parseDiskResources(text: string): ResourceDisk {
  const line = text.trim().split('\n').at(-1)?.trim();
  const match = line?.match(/^\S+\s+(\d+)\s+\d+\s+(\d+)\s+\d+%\s+.+$/);
  const totalBytes = bytes(match?.[1], 1024),
    availableBytes = bytes(match?.[2], 1024);
  if (totalBytes === null || availableBytes === null || availableBytes > totalBytes) throw new Error('磁盘指标不可用');
  return { totalBytes, availableBytes };
}
