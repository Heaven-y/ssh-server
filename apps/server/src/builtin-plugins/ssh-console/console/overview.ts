import type { SshConsoleDisk, SshConsoleHost } from '@agentdeck/shared/ssh';
import { HOST_RESOURCE_COMMAND } from '../legacy/resources/commands';
import { parseHostResources, type CpuCounters } from '../legacy/resources/parse';

const section = (name: string, command: string) => `printf '\\036${name}\\037\\n'; { ${command}; } 2>/dev/null;`;
/** 独立控制台补充主机信息，旧项目工具继续使用原采样协议。 */
export const CONSOLE_HOST_COMMAND =
  'export LC_ALL=C; ' +
  [
    section('cores', 'getconf _NPROCESSORS_ONLN'),
    section('system', 'uname -sr'),
    section('uptime', 'cat /proc/uptime'),
    HOST_RESOURCE_COMMAND,
  ].join(' ');
export const CONSOLE_DISK_COMMAND = 'export LC_ALL=C; df -Pk 2>/dev/null';

function field(text: string, name: string) {
  return text.split(`\x1e${name}\x1f`)[1]?.split('\x1e')[0]?.trim() ?? '';
}
function positive(value: string, integer = false) {
  const number = Number(value);
  if (!value || !Number.isFinite(number) || number <= 0) return null;
  return integer && !Number.isSafeInteger(number) ? null : number;
}
export function parseConsoleHost(text: string, previous?: CpuCounters) {
  const parsed = parseHostResources(text, previous);
  const data: SshConsoleHost = {
    ...parsed.data,
    cpuCores: positive(field(text, 'cores'), true),
    system:
      field(text, 'system')
        .replace(/\p{Cc}/gu, ' ')
        .slice(0, 256) || null,
    uptimeSeconds: positive(field(text, 'uptime').split(/\s+/)[0] ?? ''),
  };
  return { cpu: parsed.cpu, data };
}

const pseudo = new Set([
  'tmpfs',
  'devtmpfs',
  'devfs',
  'udev',
  'none',
  'overlay',
  'squashfs',
  'ramfs',
  'efivarfs',
  'proc',
  'sysfs',
  'devpts',
  'mqueue',
  'hugetlbfs',
  'debugfs',
  'tracefs',
  'securityfs',
  'pstore',
  'bpf',
  'configfs',
  'fusectl',
  'autofs',
  'binfmt_misc',
  'nsfs',
  'cgroup',
  'cgroup2',
  'systemd-1',
]);
function diskRow(line: string): SshConsoleDisk | undefined {
  const match = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)%\s+(.+)$/);
  if (!match) return;
  const [, filesystem, total, used, available, percent, mount] = match;
  const values = [total, used, available].map((value) => Number(value) * 1024);
  if (!values.every(Number.isSafeInteger) || values[0]! <= 0) return;
  return {
    filesystem: filesystem!,
    mount: mount!,
    totalBytes: values[0]!,
    usedBytes: values[1]!,
    availableBytes: values[2]!,
    usedPercent: Number(percent),
  };
}
export function parseConsoleDisks(text: string): SshConsoleDisk[] {
  const rows = text
    .split('\n')
    .map(diskRow)
    .filter((row) => row !== undefined);
  if (!rows.length) throw new Error('磁盘指标不可用');
  const unique = new Map<string, SshConsoleDisk>();
  for (const row of rows) {
    if (pseudo.has(row.filesystem.toLowerCase()) || /^\/dev\/loop\d+$/.test(row.filesystem)) continue;
    unique.set(JSON.stringify([row.filesystem, row.mount]), row);
  }
  return [...unique.values()].sort((a, b) => b.usedPercent - a.usedPercent || a.mount.localeCompare(b.mount));
}
