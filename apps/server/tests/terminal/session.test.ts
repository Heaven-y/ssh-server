import { EventEmitter } from 'node:events';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import type WebSocket from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import type { TerminalServerMessage, TerminalTarget, Workspace } from '@ssh-server/shared';
import { createTerminalSession } from '../../src/terminal/session';
import type { TerminalBindings } from '../../src/terminal/binding';
import { createTerminalOutput } from '../../src/terminal/output';
import { createTerminalInput } from '../../src/terminal/input';
import { createTerminalManager } from '../../src/terminal/manager';
import type { SshPool } from '../../src/ssh/pool';

afterEach(() => vi.useRealTimers());
const target: TerminalTarget = { workspaceId: 'w', sshHost: 'my-server', remoteDir: '/demo' };
const workspace: Workspace = {
  id: 'w',
  name: '工作区',
  localDir: 'fixture',
  sshHost: 'my-server',
  remoteDir: '/demo',
};
const token = `1.12345.${'a'.repeat(32)}.${'b'.repeat(64)}`;
function makeSocket() {
  const sent: Array<Buffer | TerminalServerMessage> = [];
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    bufferedAmount: 0,
    ping: vi.fn(),
    terminate: vi.fn(),
    send: vi.fn(
      (data: Buffer | string, options?: object | ((error?: Error) => void), callback?: (error?: Error) => void) => {
        sent.push(Buffer.isBuffer(data) ? data : (JSON.parse(data) as TerminalServerMessage));
        if (typeof options === 'function') options();
        else callback?.();
      },
    ),
    close: vi.fn(() => {
      socket.readyState = 3;
      socket.emit('close');
    }),
  });
  return { socket, sent };
}
function makeChannel() {
  const stream = () => Object.assign(new EventEmitter(), { pause: vi.fn(), resume: vi.fn(), readableEnded: false });
  const channel = Object.assign(stream(), {
    stderr: stream(),
    closed: false,
    destroyed: false,
    setWindow: vi.fn(),
    close: vi.fn(),
    write: vi.fn((data: string | Buffer) => {
      if (typeof data === 'string') {
        const marker = data.match(/([a-f0-9]{32}):ok/);
        if (marker) channel.emit('data', Buffer.from(`\x1e${marker[1]}:ok\x1f中文尾部`));
      }
      return true;
    }),
  });
  return channel;
}
function fixture(verify?: TerminalBindings['verify']) {
  const { socket, sent } = makeSocket();
  const channel = makeChannel();
  const sftp = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    realpath: (_path: string, cb: (error: undefined, path: string) => void) => cb(undefined, '/demo'),
    lstat: (_path: string, cb: (error: undefined, stat: object) => void) => cb(undefined, { isDirectory: () => true }),
  });
  const pool = {
    generation: () => 0,
    onCredentialsChanged: () => () => undefined,
    resolveConnection: vi.fn(async () => ({ cacheKey: 'key' })),
    openSftp: vi.fn(async () => sftp as unknown as SFTPWrapper),
    openShell: vi.fn(async () => channel as unknown as ClientChannel),
  };
  const checked = { workspace, fingerprint: 'fingerprint', generation: 0 };
  const bindings = { issue: vi.fn(), verify: verify ?? vi.fn(async () => checked) } as TerminalBindings;
  const closed = vi.fn();
  const session = createTerminalSession({
    workspaceId: 'w',
    socket: socket as unknown as WebSocket,
    pool: pool as never,
    bindings,
    onClosed: closed,
  });
  socket.emit(
    'message',
    Buffer.from(JSON.stringify({ type: 'open', target, binding: token, size: { cols: 80, rows: 24 } })),
    false,
  );
  return { socket, sent, channel, pool, session, closed, checked };
}
const controls = (sent: Array<Buffer | TerminalServerMessage>) =>
  sent.filter((item): item is TerminalServerMessage => !Buffer.isBuffer(item));

it('初始化移交前退出保留真实状态，不能发送ready', async () => {
  let resume!: (value: ReturnType<typeof fixture>['checked']) => void;
  let count = 0;
  const checked = { workspace, fingerprint: 'fingerprint', generation: 0 };
  const f = fixture(
    vi.fn(async () => {
      if (++count === 3)
        return new Promise<typeof checked>((resolve) => {
          resume = resolve;
        });
      return checked;
    }),
  );
  try {
    await vi.waitFor(() => expect(count).toBe(3));
    f.channel.emit('exit', 7);
    f.channel.emit('end');
    f.channel.stderr.emit('end');
    f.channel.emit('close');
    resume(checked);
    await vi.waitFor(() => expect(f.closed).toHaveBeenCalledOnce());
    expect(controls(f.sent).some((m) => m.type === 'ready')).toBe(false);
    expect(controls(f.sent)).toContainEqual({ type: 'exit', exitCode: 7, signal: null, outputComplete: false });
  } finally {
    f.session.close();
  }
});
it('EOF是半关闭，等待真实exit后才排空并报告退出，单窗格不disconnect', async () => {
  const f = fixture();
  try {
    await vi.waitFor(() => expect(controls(f.sent).some((m) => m.type === 'ready')).toBe(true));
    f.socket.emit('message', Buffer.from(JSON.stringify({ type: 'resize', size: { cols: 160, rows: 40 } })), false);
    expect(f.channel.setWindow).toHaveBeenCalledWith(40, 160, 0, 0);
    f.channel.emit('data', Buffer.from('最后输出'));
    f.channel.emit('end');
    f.channel.stderr.emit('end');
    expect(controls(f.sent).some((m) => m.type === 'exit')).toBe(false);
    f.channel.emit('exit', 7);
    expect(controls(f.sent).at(-1)).toEqual({ type: 'exit', exitCode: 7, signal: null, outputComplete: true });
    expect(f.sent.findIndex((m) => Buffer.isBuffer(m) && m.toString() === '最后输出')).toBeLessThan(
      f.sent.findIndex((m) => !Buffer.isBuffer(m) && m.type === 'exit'),
    );
    expect(f.closed).toHaveBeenCalledOnce();
  } finally {
    f.session.close();
  }
});
it('输出分帧并暂停两种流，非法ack和缓冲上限明确终止', () => {
  const f = makeSocket();
  const channel = makeChannel();
  const fail = vi.fn();
  const ended = vi.fn();
  const output = createTerminalOutput({
    socket: f.socket as unknown as WebSocket,
    channel: channel as unknown as ClientChannel,
    fail,
    ended,
  });
  try {
    output.push(Buffer.alloc(262144));
    expect(f.sent.filter(Buffer.isBuffer)).toHaveLength(8);
    expect(channel.pause).toHaveBeenCalled();
    expect(channel.stderr.pause).toHaveBeenCalled();
    output.ack(262144 - 65535);
    expect(channel.resume).toHaveBeenCalled();
    expect(channel.stderr.resume).toHaveBeenCalled();
    output.ack(65536);
    expect(fail).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'invalid_ack' }));
    output.push(Buffer.alloc(1048576));
    expect(fail).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'output_congested' }));
  } finally {
    output.dispose();
  }
});
it('有未消费输出60秒后结束，空闲不超时', async () => {
  vi.useFakeTimers();
  const f = makeSocket();
  const fail = vi.fn();
  const output = createTerminalOutput({
    socket: f.socket as unknown as WebSocket,
    channel: makeChannel() as unknown as ClientChannel,
    fail,
    ended: vi.fn(),
  });
  await vi.advanceTimersByTimeAsync(60000);
  expect(fail).not.toHaveBeenCalled();
  output.push(Buffer.from('pending'));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'consumer_timeout' }));
  output.dispose();
});
it('输入write背压等待drain，待写超过256KiB时停止该窗格', () => {
  const channel = makeChannel();
  channel.write.mockReturnValue(false);
  const notify = vi.fn();
  const fail = vi.fn();
  const input = createTerminalInput({ channel: channel as unknown as ClientChannel, notify, fail });
  input.enqueue(Buffer.alloc(32768));
  input.enqueue(Buffer.alloc(32768));
  expect(channel.write).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith(true);
  channel.emit('drain');
  expect(channel.write).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 9; i++) input.enqueue(Buffer.alloc(32768));
  expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'input_overflow' }));
  input.dispose();
  expect(channel.listenerCount('drain')).toBe(0);
});
it('等待open占用名额，工作区8个/合计32个上限独立回收', () => {
  const manager = createTerminalManager({
    store: { get: vi.fn() },
    pool: {} as SshPool,
    bindings: {} as TerminalBindings,
  });
  const sockets = [];
  try {
    for (let group = 0; group < 4; group++)
      for (let i = 0; i < 8; i++) {
        const f = makeSocket();
        sockets.push(f);
        manager.attach(`w${group}`, f.socket as unknown as WebSocket);
      }
    const workspaceFull = makeSocket();
    manager.attach('w0', workspaceFull.socket as unknown as WebSocket);
    expect(controls(workspaceFull.sent)[0]).toMatchObject({ type: 'error', code: 'limit_reached' });
    const globalFull = makeSocket();
    manager.attach('another', globalFull.socket as unknown as WebSocket);
    expect(controls(globalFull.sent)[0]).toMatchObject({ type: 'error', code: 'limit_reached' });
    sockets[0]!.socket.close();
    const next = makeSocket();
    manager.attach('another', next.socket as unknown as WebSocket);
    expect(next.sent).toEqual([]);
  } finally {
    manager.dispose();
  }
});
it('startup30秒与pong60秒超时均清理会话', async () => {
  vi.useFakeTimers();
  const waiting = makeSocket();
  const closed = vi.fn();
  createTerminalSession({
    workspaceId: 'w',
    socket: waiting.socket as unknown as WebSocket,
    pool: {} as SshPool,
    bindings: {} as TerminalBindings,
    onClosed: closed,
  });
  await vi.advanceTimersByTimeAsync(30000);
  expect(controls(waiting.sent)[0]).toMatchObject({ type: 'error', code: 'startup_failed' });
  expect(closed).toHaveBeenCalledOnce();
  const f = fixture();
  await vi.waitFor(() => expect(controls(f.sent).some((m) => m.type === 'ready')).toBe(true));
  const bytes = f.sent.filter(Buffer.isBuffer).reduce((count, data) => count + data.length, 0);
  f.socket.emit('message', Buffer.from(JSON.stringify({ type: 'ack', bytes })), false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(controls(f.sent)).toContainEqual(expect.objectContaining({ type: 'error', code: 'connection_lost' }));
  expect(f.closed).toHaveBeenCalledOnce();
});
it('无效控制帧不能开启通道，ready后网络错误/断线只回收本会话', async () => {
  const before = makeSocket();
  const pool = { openShell: vi.fn() };
  const closed = vi.fn();
  createTerminalSession({
    workspaceId: 'w',
    socket: before.socket as unknown as WebSocket,
    pool: pool as never,
    bindings: {} as TerminalBindings,
    onClosed: closed,
  });
  before.socket.emit('message', Buffer.from('not-json'), false);
  expect(pool.openShell).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledOnce();
  const f = fixture();
  await vi.waitFor(() => expect(controls(f.sent).some((m) => m.type === 'ready')).toBe(true));
  f.channel.emit('error', new Error('network'));
  expect(controls(f.sent)).toContainEqual(expect.objectContaining({ type: 'error', code: 'connection_lost' }));
  expect(controls(f.sent).at(-1)).toMatchObject({ type: 'exit', outputComplete: false });
  f.socket.emit('close');
  expect(f.closed).toHaveBeenCalledOnce();
});
it('输出send失败绝不声称完整退出', () => {
  const f = makeSocket();
  const ended = vi.fn();
  const fail = vi.fn(() => output.dispose());
  const output = createTerminalOutput({
    socket: f.socket as unknown as WebSocket,
    channel: makeChannel() as unknown as ClientChannel,
    fail,
    ended,
  });
  f.socket.send.mockImplementation((_data, _options, callback) => {
    callback?.(new Error('send failed'));
  });
  output.push(Buffer.from('pending'));
  output.finish({ exitCode: 0, signal: null });
  expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'output_congested' }));
  expect(ended).not.toHaveBeenCalled();
  expect(controls(f.sent).some((m) => m.type === 'exit')).toBe(false);
});
