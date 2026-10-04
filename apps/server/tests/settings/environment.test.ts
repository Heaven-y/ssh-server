import { access } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { detectEnvironment } from '../../src/settings/environment';
import type { ProcessRunner } from '../../src/sync/process';

it('Claude检测复用实际已安装的SDK原生入口，探测只传版本参数且有界', async () => {
  const run: ProcessRunner = vi.fn(async (command, args, options) => {
    expect(options).toMatchObject({ timeoutMs: 5000, outputCap: 2048 });
    if (args.includes('--version') && command.includes('claude')) {
      await access(command);
      expect(args).toEqual(['--version']);
      return { stdout: Buffer.from('2.1.286 (Claude Code)\n'), stderr: Buffer.alloc(0), exitCode: 0 };
    }
    const stdout = args.includes('version')
      ? 'rclone v1.75.1\n'
      : command === 'git'
        ? 'git version 2.55.0\n'
        : 'codex-cli 0.156.1\n';
    return { stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), exitCode: 0 };
  });
  const report = await detectEnvironment({ run });
  expect(report.tools.find((tool) => tool.name === 'Claude Code')).toMatchObject({
    available: true,
    version: '2.1.286',
  });
});

it('非零、格式异常和探测失败不标可用，也不回传内部输出', async () => {
  for (const result of [
    { stdout: Buffer.from('secret-private-path 1.2.3'), stderr: Buffer.alloc(0), exitCode: 0 },
    { stdout: Buffer.from('git version 1.2.3'), stderr: Buffer.from('secret'), exitCode: 1 },
  ]) {
    const report = await detectEnvironment({ run: async () => result });
    expect(report.tools.slice(1).every((tool) => !tool.available && tool.version === null)).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret');
  }
  const report = await detectEnvironment({
    run: async () => {
      throw new Error('secret-private-path');
    },
  });
  expect(report.tools.slice(1).every((tool) => !tool.available)).toBe(true);
  expect(JSON.stringify(report)).not.toContain('secret');
});
