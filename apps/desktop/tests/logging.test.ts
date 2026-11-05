import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { createDesktopLogger } from '../src/logging';

it('关闭的输出管道不使桌面崩溃，另一日志通道仍可用且其他异常不被吞掉', async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const logger = createDesktopLogger(stdout, stderr);
  const closed = new Promise<void>((resolve) => stdout.once('close', resolve));
  stdout.destroy(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
  await closed;
  expect(() => logger.log('接收端已退出')).not.toThrow();
  logger.error('仍可读取的诊断');
  expect(stderr.read()?.toString()).toBe('仍可读取的诊断\n');
  const unexpected = Object.assign(new Error('unexpected failure'), { code: 'EIO' });
  expect(() => stderr.emit('error', unexpected)).toThrow(unexpected);
  stderr.destroy();
});
