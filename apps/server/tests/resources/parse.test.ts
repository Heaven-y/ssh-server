import { expect, it } from 'vitest';
import { parseDiskResources, parseHostResources } from '../../src/resources/parse';
import { diskResourceCommand } from '../../src/resources/commands';
import { resourceFixtureOutput, resourceSection } from '../../../../scripts/dev/resource-fixture';

it('CPU首帧空值，连续差分排除guest，重启累计值不伪造负利用率', () => {
  const first = parseHostResources(resourceFixtureOutput(1));
  expect(first.data.cpuPercent).toBeNull();
  const second = parseHostResources(
    resourceFixtureOutput(2).replace('cpu 120 0 100 820 0 0 0 0 0 0', 'cpu 120 0 100 820 0 0 0 0 9999 9999'),
    first.cpu,
  );
  expect(second.data.cpuPercent).toBe(50);
  expect(parseHostResources(resourceFixtureOutput(0), second.cpu).data.cpuPercent).toBeNull();
  expect(parseHostResources(resourceFixtureOutput(2), second.cpu).data.cpuPercent).toBeNull();
});

it('CSV引号逗号、物理GPU编号、N/A及PID关联按真实字段解析', () => {
  const host = parseHostResources(resourceFixtureOutput(1)).data;
  expect(host.gpus?.[0]).toMatchObject({ index: 3, name: 'Fixture, GPU', temperature: null, power: 120.5 });
  expect(host.memoryUsed).toBe(4 * 1024 ** 3);
  expect(host.processes?.[0]).toMatchObject({
    pid: 123,
    command: 'python',
    memoryBytes: 65536 * 1024,
    gpus: [{ uuid: 'GPU-demo', memoryBytes: 512 * 1024 ** 2 }],
  });
  expect(host.gpuProcessesAvailable).toBe(true);
});

it('缺失工具、MemAvailable及非法字段保持不可用，截断协议拒绝', () => {
  const text =
    resourceSection('cpu', 'cpu bad 0 0 0') +
    resourceSection('load', '1 bad 2') +
    resourceSection('memory', 'MemTotal: 100 kB') +
    resourceSection('gpu', '"broken') +
    resourceSection('process', 'bad\n0 bad bad command') +
    resourceSection('done', '');
  const host = parseHostResources(text).data;
  expect(host).toMatchObject({
    hostname: null,
    cpuPercent: null,
    load: null,
    memoryUsed: null,
    memoryTotal: 102400,
    gpus: null,
    processes: null,
    gpuProcessesAvailable: false,
  });
  expect(() => parseHostResources('partial')).toThrow('资源输出不完整');
});

it('磁盘换算保留真实容量，HOME和引号安全转义，非法目录或容量拒绝', () => {
  expect(
    parseDiskResources('Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/demo 10000 4000 6000 40% demo'),
  ).toEqual({ totalBytes: 10240000, availableBytes: 6144000 });
  expect(() => parseDiskResources('/dev/demo 1 0 2 0% demo')).toThrow();
  expect(() => parseDiskResources('not supported')).toThrow();
  expect(diskResourceCommand('~')).toContain('"$HOME"');
  expect(diskResourceCommand("~/demo's files")).toContain("'demo'\\''s files'");
  expect(diskResourceCommand('relative')).toContain("'relative'");
  expect(() => diskResourceCommand('bad\npath')).toThrow('服务器目录不合法');
});
