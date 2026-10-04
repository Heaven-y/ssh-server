import { sq } from '../ssh/remote-command';

const section = (name: string, command: string) => `printf '\\036${name}\\037\\n'; { ${command}; } 2>/dev/null;`;
/** 固定只读命令；不读取进程完整参数，避免返回命令行中的敏感字段。 */
export const HOST_RESOURCE_COMMAND =
  'export LC_ALL=C; ' +
  [
    section('host', 'hostname'),
    section('cpu', 'head -n 1 /proc/stat'),
    section('load', 'cat /proc/loadavg'),
    section('memory', 'cat /proc/meminfo'),
    section(
      'gpu',
      'timeout 3 nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits',
    ),
    section(
      'gpuprocess',
      'resource_gpu_process_output=$(timeout 3 nvidia-smi --query-compute-apps=pid,gpu_uuid,used_memory --format=csv,noheader,nounits); ' +
        'resource_gpu_process_status=$?; printf "%s\\n" "$resource_gpu_process_output" | head -n 100; ' +
        'printf "\\036gpustatus\\037\\n%s\\n" "$resource_gpu_process_status"',
    ),
    section('process', 'ps -eo pid=,pcpu=,rss=,comm= --sort=-pcpu | head -n 50'),
  ].join(' ') +
  "printf '\\036done\\037\\n'";

export function diskResourceCommand(remoteDir: string): string {
  if (!remoteDir || /[\r\n\0]/.test(remoteDir) || remoteDir.length > 4096) throw new Error('服务器目录不合法');
  const directory =
    remoteDir === '~' ? '"$HOME"' : remoteDir.startsWith('~/') ? `"$HOME"/${sq(remoteDir.slice(2))}` : sq(remoteDir);
  return `export LC_ALL=C; df -Pk -- ${directory} 2>/dev/null`;
}
