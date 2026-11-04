import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SshConsoleTerminalRead } from '@agentdeck/shared';
import { createConsoleTerminalConnection } from '../../../src/features/ssh-console/terminal-connection';

const base: SshConsoleTerminalRead = {
  id: 'terminal-1',
  serverId: 'my-server',
  cols: 80,
  rows: 24,
  startDir: '~',
  startedAt: 1,
  exited: false,
  exitCode: null,
  signal: null,
  seq: 100,
  start: 0,
  inputPaused: false,
  data: '',
  nextSeq: 0,
  reset: false,
};
const replies: SshConsoleTerminalRead[] = [];
const calls: Array<{ url: string; init?: RequestInit }> = [];
let rejectInput = false;
let readStatus = 200;
beforeEach(() => {
  vi.useFakeTimers();
  replies.length = 0;
  calls.length = 0;
  rejectInput = false;
  readStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/input')) {
        if (rejectInput) return Response.json({ message: '合成输入失败' }, { status: 502 });
        const { data } = JSON.parse(init!.body as string) as { data: string };
        return Response.json({ written: Buffer.from(data, 'base64').length });
      }
      if (url.endsWith('/resize')) return Response.json(base);
      if (readStatus !== 200)
        return Response.json({ message: '终端已失效', code: 'terminal_missing' }, { status: readStatus });
      return Response.json(replies.shift() ?? { ...base, nextSeq: 7 });
    }),
  );
});

it('后端PTY已失效时停止自动读取，显式重新打开视图才再次读取', async () => {
  readStatus = 404;
  const f = setup();
  f.connection.setVisible(true);
  await tick(1000);
  expect(calls).toHaveLength(1);
  f.connection.setVisible(false);
  f.connection.setVisible(true);
  await tick();
  expect(calls).toHaveLength(2);
  f.connection.dispose();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  const output = vi.fn(async (_bytes: Uint8Array, _reset: boolean) => undefined);
  const error = vi.fn();
  return {
    output,
    error,
    connection: createConsoleTerminalConnection({
      serverId: 'my-server',
      terminalId: 'terminal-1',
      output,
      error,
      state: vi.fn(),
      availability: vi.fn(),
    }),
  };
}
async function tick(ms = 1) {
  await vi.advanceTimersByTimeAsync(ms);
}

it('输出只按nextSeq接续且保留原始UTF8字节，隐藏停止读取，恢复从原游标继续', async () => {
  replies.push(
    { ...base, data: Buffer.from([0xe4, 0xb8]).toString('base64'), nextSeq: 2, reset: true },
    { ...base, data: Buffer.from([0xad, 0x0a]).toString('base64'), nextSeq: 4 },
  );
  const f = setup();
  f.connection.setVisible(true);
  await tick();
  await tick(120);
  expect(calls[1]?.url).toContain('fromSeq=2');
  expect(f.output.mock.calls[0]).toEqual([new Uint8Array([0xe4, 0xb8]), true]);
  expect(f.output.mock.calls[1]).toEqual([new Uint8Array([0xad, 0x0a]), false]);
  f.connection.setVisible(false);
  const count = calls.length;
  await tick(1000);
  expect(calls).toHaveLength(count);
  f.connection.setVisible(true);
  await tick();
  expect(calls.at(-1)?.url).toContain('fromSeq=4');
  f.connection.dispose();
  await tick(1000);
  expect(calls.some(({ init }) => init?.method === 'DELETE')).toBe(false);
});

it('输入分成32KiB请求且顺序完整，未知写入结果不自动重发，卸载不关闭PTY', async () => {
  const f = setup();
  f.connection.setVisible(true);
  await tick();
  const bytes = new TextEncoder().encode('中文'.repeat(7000));
  expect(f.connection.input(bytes)).toBe(true);
  await tick();
  const inputs = calls.filter(({ url }) => url.endsWith('/input'));
  expect(inputs).toHaveLength(2);
  const decoded = inputs.map(({ init }) =>
    Buffer.from((JSON.parse(init!.body as string) as { data: string }).data, 'base64'),
  );
  expect(decoded[0]!.length).toBe(32768);
  expect(Buffer.concat(decoded)).toEqual(Buffer.from(bytes));
  rejectInput = true;
  f.connection.input(new TextEncoder().encode('uncertain'));
  await tick();
  expect(f.error).toHaveBeenCalled();
  const writes = calls.filter(({ url }) => url.endsWith('/input')).length;
  await tick(400);
  expect(calls.filter(({ url }) => url.endsWith('/input'))).toHaveLength(writes);
  f.connection.dispose();
});
