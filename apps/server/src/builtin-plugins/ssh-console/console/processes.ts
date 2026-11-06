import { SSH_CONSOLE_LIMITS, type SshConsoleGpuProcess, type SshConsoleProcess } from '@agentdeck/shared/ssh';
import { parse } from 'csv-parse/sync';
export type ConsoleProcessData = {
  processes: SshConsoleProcess[];
  gpuProcesses: SshConsoleGpuProcess[];
  gpuProcessesAvailable: boolean;
  truncated: boolean;
};
const section = (name: string, command: string) => `printf '\\036${name}\\037\\n'; { ${command}; } 2>/dev/null;`;

/** 固定只读命令；完整命令行只返回人工控制台，不记录日志或传给 Agent。 */
export const CONSOLE_PROCESS_COMMAND =
  'export LC_ALL=C; ' +
  [
    section(
      'process',
      'console_process_output=$(ps -ww -eo pid=,ppid=,user=,pcpu=,pmem=,etime=,stat=,nlwp=,rss=,args= --sort=-pcpu); console_process_status=$?; printf "%s\\n" "$console_process_output" | head -n 101',
    ),
    section('processstatus', 'printf "%s\\n" "$console_process_status"'),
    section('gpu', 'timeout 3 nvidia-smi --query-gpu=index,uuid --format=csv,noheader,nounits'),
    section(
      'gpuprocess',
      'console_gpu_output=$(timeout 3 nvidia-smi --query-compute-apps=pid,gpu_uuid,used_memory --format=csv,noheader,nounits); console_gpu_status=$?; printf "%s\\n" "$console_gpu_output"',
    ),
    section('gpustatus', 'printf "%s\\n" "$console_gpu_status"'),
    section(
      'owner',
      'console_gpu_pids=$(printf "%s\\n" "$console_gpu_output" | awk -F, \'$1 ~ /^[[:space:]]*[0-9]+[[:space:]]*$/ {gsub(/[[:space:]]/, "", $1); print $1}\' | sort -nu | head -n 512 | paste -sd, -); [ -z "$console_gpu_pids" ] || ps -ww -o pid=,user=,args= -p "$console_gpu_pids"',
    ),
  ].join(' ') +
  "printf '\\036done\\037\\n'";

function number(value: string | undefined, multiplier = 1): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const result = Number(value) * multiplier;
  return Number.isFinite(result) && result >= 0 ? result : null;
}
const clean = (value: string) => value.replace(/\p{Cc}/gu, ' ').trim();
function processRow(line: string): SshConsoleProcess | undefined {
  const fields = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
  if (!fields || Number(fields[1]) < 1) return;
  return {
    pid: Number(fields[1]),
    ppid: Number(fields[2]),
    user: clean(fields[3]!),
    cpuPercent: number(fields[4]),
    memoryPercent: number(fields[5]),
    elapsed: clean(fields[6]!),
    state: clean(fields[7]!),
    threads: number(fields[8]),
    memoryBytes: number(fields[9], 1024),
    command: clean(fields[10]!),
  };
}
function csv(value: string): string[][] {
  try {
    return parse(value, { trim: true, skip_empty_lines: true, relax_column_count: true });
  } catch {
    return [];
  }
}
function sections(value: string) {
  const result: Record<string, string> = {};
  // eslint-disable-next-line no-control-regex -- 复用固定RS/US分节协议。
  const chunks = value.split(/\x1e([a-z]+)\x1f\r?\n/);
  for (let index = 1; index < chunks.length; index += 2) result[chunks[index]!] = chunks[index + 1]!.trim();
  if (!Object.hasOwn(result, 'done')) throw new Error('进程输出不完整');
  return result;
}
function ownersFrom(text: string) {
  const owners = new Map<number, { user: string; command: string }>();
  for (const line of text.split('\n')) {
    const fields = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (fields) owners.set(Number(fields[1]), { user: clean(fields[2]!), command: clean(fields[3]!) });
  }
  return owners;
}
function gpuRow(
  fields: string[],
  indices: Map<string | undefined, number | null>,
  owners: ReturnType<typeof ownersFrom>,
): SshConsoleGpuProcess | undefined {
  const [pid, uuid, memory] = fields;
  const id = number(pid);
  if (!id || !Number.isInteger(id) || !uuid?.startsWith('GPU-')) return;
  const owner = owners.get(id);
  return {
    pid: id,
    gpuUuid: uuid,
    gpuIndex: indices.get(uuid) ?? null,
    memoryBytes: number(memory, 1024 * 1024),
    user: owner?.user ?? null,
    command: owner?.command ?? null,
  };
}
function compareGpu(a: SshConsoleGpuProcess, b: SshConsoleGpuProcess) {
  return (a.gpuIndex ?? 65536) - (b.gpuIndex ?? 65536) || (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0) || a.pid - b.pid;
}
function gpuRows(parts: Record<string, string>) {
  const indices = new Map(csv(parts.gpu ?? '').map(([index, uuid]) => [uuid, number(index)]));
  const owners = ownersFrom(parts.owner ?? '');
  const rows: SshConsoleGpuProcess[] = [];
  for (const fields of csv(parts.gpuprocess ?? '')) {
    const row = gpuRow(fields, indices, owners);
    if (row) rows.push(row);
  }
  return rows.sort(compareGpu);
}
export function parseConsoleProcesses(text: string): ConsoleProcessData {
  const parts = sections(text);
  if (parts.processstatus !== '0') throw new Error('远端进程工具未完成采样');
  const processes = (parts.process ?? '')
    .split('\n')
    .map(processRow)
    .filter((row) => row !== undefined);
  const gpuProcessesAvailable = parts.gpustatus === '0';
  const gpuProcesses = gpuProcessesAvailable ? gpuRows(parts) : [];
  return {
    processes: processes.slice(0, SSH_CONSOLE_LIMITS.processRows),
    gpuProcesses: gpuProcesses.slice(0, SSH_CONSOLE_LIMITS.gpuProcessRows),
    gpuProcessesAvailable,
    truncated:
      processes.length > SSH_CONSOLE_LIMITS.processRows || gpuProcesses.length > SSH_CONSOLE_LIMITS.gpuProcessRows,
  };
}
