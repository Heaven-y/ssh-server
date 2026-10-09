import { expect, it } from 'vitest';
import { parseSlurmOutput, slurmFailure } from '../../src/slurm/parse';
import { slurmHeader, slurmOutput } from './fixture';

const sampledAt = 1_800_000_000_000;

it('直接保留当前账号 squeue 文本，统一补与固定格式右对齐的英文列头', () => {
  const running = '         102_[1-4]       gpu                 training     demo  R    1:02:03      2 node[01-02]';
  const text = slurmOutput() + running + '\n';
  expect(parseSlurmOutput(text, sampledAt)).toEqual({
    sampledAt,
    status: 'available',
    output: `${slurmHeader}\n${slurmOutput()}${running}`,
    truncated: false,
  });
  const header = parseSlurmOutput(text, sampledAt).output.split('\n')[0]!;
  expect(header.slice(0, 18)).toBe('JOBID'.padStart(18));
  expect(header.slice(19, 28)).toBe('PARTITION');
  expect(header.slice(29, 53)).toBe('NAME'.padStart(24));
  expect(header.slice(54, 62)).toBe('USER'.padStart(8));
  expect(header.slice(63, 65)).toBe('ST');
  expect(header.slice(66, 76)).toBe('TIME'.padStart(10));
  expect(header.slice(77, 83)).toBe('NODES'.padStart(6));
  expect(header.slice(84)).toBe('NODELIST(REASON)');
});

it.each(['', '\n', '\r\n'])('成功空输出不补列头，不保留结构化作业字段：%j', (text) => {
  expect(parseSlurmOutput(text, sampledAt)).toEqual({
    sampledAt,
    status: 'available',
    output: '',
    truncated: false,
  });
});

it('统一 CRLF 并只去末尾换行；保留每行前导、尾部空格和原列对齐', () => {
  const first = slurmOutput().replace(/\n$/, '  ');
  const second = slurmOutput(102).replace(/\n$/, ' ');
  const result = parseSlurmOutput(`${first}\r\n${second}\r\n`, sampledAt);
  expect(result.output).toBe(`${slurmHeader}\n${first}\n${second}`);
  expect(result.output).not.toContain('\r');
});

it('特殊 HTML、引号、中文和未知状态或时长原样作为文本，不解释字段', () => {
  const text = '  123 gpu <img src=x onerror=alert(1)> & "中文"; $(not-a-command) demo ?? UNLIMITED 1 (未知原因)';
  expect(parseSlurmOutput(text, sampledAt)).toEqual({
    sampledAt,
    status: 'available',
    output: `${slurmHeader}\n${text}`,
    truncated: false,
  });
});

it.each(['', slurmOutput()])('成功警告即使没有 stdout 也保留通用提示：%j', (text) => {
  const result = parseSlurmOutput(text, sampledAt, true);
  expect(result).toMatchObject({
    sampledAt,
    status: 'available',
    output: text ? `${slurmHeader}\n${text.replace(/\n$/, '')}` : '',
    truncated: false,
    message: 'Slurm 返回警告，结果可能不完整',
  });
});

it.each([199, 200, 201])('最多显示前 200 行作业输出，列头和末尾换行不占限额（%i 行）', (count) => {
  const rows = Array.from({ length: count }, (_, i) => slurmOutput(i + 1));
  const result = parseSlurmOutput(rows.join(''), sampledAt);
  expect(result).toEqual({
    sampledAt,
    status: 'available',
    output: `${slurmHeader}\n${rows.slice(0, 200).join('').replace(/\n$/, '')}`,
    truncated: count > 200,
  });
  expect(result.output.split('\n')).toHaveLength(Math.min(count, 200) + 1);
});

it('行数截断不丢弃警告，也不冒充精确作业数', () => {
  const result = parseSlurmOutput(slurmOutput().repeat(201), sampledAt, true);
  expect(result).toMatchObject({ status: 'available', truncated: true, message: expect.stringContaining('警告') });
  expect(result).not.toHaveProperty('jobs');
});

it('512 KiB 以 UTF-8 字节计；超预算整份拒绝，不能先按 200 行截短绕过预算', () => {
  const text = '中'.repeat(180_000);
  expect(text.length).toBeLessThan(512 * 1024);
  for (const output of [text, 'x'.repeat(512 * 1024 + 1), slurmOutput().repeat(201) + text]) {
    expect(parseSlurmOutput(output, sampledAt)).toEqual({
      sampledAt,
      status: 'error',
      output: '',
      truncated: false,
      message: expect.stringContaining('512 KiB'),
    });
  }
  const exact = 'x'.repeat(512 * 1024);
  expect(parseSlurmOutput(exact, sampledAt)).toEqual({
    sampledAt,
    status: 'available',
    output: `${slurmHeader}\n${exact}`,
    truncated: false,
  });
});

it.each(['unavailable', 'error'] as const)('失败快照只有空文本而不是残缺表格：%s', (status) => {
  expect(slurmFailure(status, '请重试', sampledAt)).toEqual({
    sampledAt,
    status,
    output: '',
    truncated: false,
    message: '请重试',
  });
});
