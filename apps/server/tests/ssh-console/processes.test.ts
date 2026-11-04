import { expect, it } from 'vitest';
import { parseConsoleProcesses } from '../../src/ssh-console/processes';

const section = (name: string, value: string) => `\x1e${name}\x1f\n${value}\n`;
it('GPU进程独立于CPU前列且完整保留用户和命令，按卡排序后返回', () => {
  const command = `python /opt/experiments/train.py ${'argument '.repeat(40)}`.trim();
  const text =
    section('processstatus', '0') +
    section('process', `11 1 demo 12.5 1.2 00:03 S 8 1024 ${command}`) +
    section('gpu', '3, GPU-b\n0, GPU-a') +
    section('gpuprocess', '99, GPU-b, 1024\n77, GPU-a, 512') +
    section('owner', `99 other python /opt/long-job.py\n77 demo ${command}`) +
    section('gpustatus', '0') +
    section('done', '');
  const result = parseConsoleProcesses(text);
  expect(result.processes).toEqual([
    {
      pid: 11,
      ppid: 1,
      user: 'demo',
      cpuPercent: 12.5,
      memoryPercent: 1.2,
      elapsed: '00:03',
      state: 'S',
      threads: 8,
      memoryBytes: 1024 * 1024,
      command,
    },
  ]);
  expect(result.gpuProcesses.map((row) => [row.pid, row.gpuIndex, row.user])).toEqual([
    [77, 0, 'demo'],
    [99, 3, 'other'],
  ]);
  expect(result.gpuProcesses[0]?.command).toBe(command);
  expect(result.gpuProcessesAvailable).toBe(true);
});

it('不完整采样拒绝，GPU不可用不伪造零使用率，进程行数截断有标记', () => {
  expect(() => parseConsoleProcesses(section('process', ''))).toThrow();
  const processes = Array.from({ length: 101 }, (_, index) => `${index + 1} 1 demo 1 2 00:01 S 1 512 /bin/tool`).join(
    '\n',
  );
  const result = parseConsoleProcesses(
    section('processstatus', '0') + section('process', processes) + section('gpustatus', '127') + section('done', ''),
  );
  expect(result).toMatchObject({ gpuProcessesAvailable: false, gpuProcesses: [], truncated: true });
  expect(result.processes).toHaveLength(100);
});

it('ps自身失败不能被尾部成功标记掩盖成空进程列表', () => {
  expect(() =>
    parseConsoleProcesses(section('process', '') + section('processstatus', '127') + section('done', '')),
  ).toThrow();
});
