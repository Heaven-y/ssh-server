import { PassThrough } from 'node:stream';
import type { ClientChannel } from 'ssh2';
import { expect, it, vi } from 'vitest';
import { createRemoteExecutor, type HelperInput } from '../../src/remote-files/executor';

function channel() {
  const value = Object.assign(new PassThrough(), {
    stderr: new PassThrough(),
    signal: vi.fn(),
    close: vi.fn(() => value.destroy()),
  });
  return value;
}
const input: HelperInput = { action: 'execute', kind: 'delete', roots: [] };
const target = { alias: 'my-server', authMode: 'key' as const };

it('固定执行器按顺序处理阶段与结果，参数通过 base64 传递且不转发 stderr', async () => {
  const connection = channel();
  const openExec = vi.fn(async () => {
    setImmediate(() => {
      connection.stderr.write('private diagnostic');
      connection.write(JSON.stringify({ event: 'phase', phase: 'removing_source' }) + '\n');
      connection.write(JSON.stringify({ event: 'result', result: { completed: true } }) + '\n');
      connection.emit('exit', 0);
      connection.end();
    });
    return connection as unknown as ClientChannel;
  });
  const phase = vi.fn(async () => undefined);
  const executor = createRemoteExecutor({ openExec });
  expect(await executor.run(target, input, { onPhase: phase })).toEqual({ completed: true });
  expect(phase).toHaveBeenCalledWith({ event: 'phase', phase: 'removing_source' });
  const command = (openExec.mock.calls as unknown as Array<[unknown, string]>)[0]![1];
  expect(command).toContain(Buffer.from(JSON.stringify(input)).toString('base64'));
  expect(connection.close).toHaveBeenCalledOnce();
});

it('远端拒绝码与不完整输出不能冒充执行成功，取消只关闭自己的通道', async () => {
  for (const output of [JSON.stringify({ event: 'error', code: 'destination_exists' }) + '\n', 'incomplete']) {
    const connection = channel();
    const executor = createRemoteExecutor({
      openExec: async () => {
        setImmediate(() => {
          connection.emit('exit', 1);
          connection.end(output);
        });
        return connection as unknown as ClientChannel;
      },
    });
    await expect(executor.run(target, input)).rejects.toBeInstanceOf(Error);
    expect(connection.close).toHaveBeenCalledOnce();
  }
  const connection = channel();
  const controller = new AbortController();
  const executor = createRemoteExecutor({
    openExec: async () => {
      setImmediate(() => controller.abort());
      return connection as unknown as ClientChannel;
    },
  });
  await expect(executor.run(target, input, { signal: controller.signal })).rejects.toBeInstanceOf(Error);
  expect(connection.signal).toHaveBeenCalledWith('TERM');
  expect(connection.destroyed).toBe(true);
});
