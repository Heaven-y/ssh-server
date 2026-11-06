import { afterEach, expect, it, vi } from 'vitest';
import { createSshConsoleService } from '../../../../src/builtin-plugins/ssh-console/console/service';
import { consoleFixture } from './console.fixture';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
function fixture() {
  const f = consoleFixture();
  const service = createSshConsoleService(f);
  cleanups.push(() => service.dispose());
  return { ...f, service };
}

it('终端按服务器保存并可重新列举，输入和关闭不会串服务器或断开共享连接', async () => {
  const f = fixture();
  const first = await f.service.createTerminal('my-server', { cols: 80, rows: 24 });
  const other = await f.service.createTerminal('other-server', { cols: 90, rows: 30 });
  f.shells[0]!.emit('data', Buffer.from('中文输出'));
  expect((await f.service.listTerminals('my-server')).terminals.map((terminal) => terminal.id)).toEqual([first.id]);
  expect(Buffer.from((await f.service.readTerminal('my-server', first.id, 0)).data, 'base64').toString()).toBe(
    '中文输出',
  );
  await expect(f.service.writeTerminal('other-server', first.id, 'YQ==')).rejects.toMatchObject({
    code: 'terminal_missing',
  });
  await f.service.writeTerminal('my-server', first.id, 'YQ==');
  expect(f.shells[0]!.write).toHaveBeenLastCalledWith(Buffer.from('a'));
  await f.service.resizeTerminal('my-server', first.id, { cols: 120, rows: 40 });
  expect(f.shells[0]!.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
  await f.service.closeTerminal('my-server', first.id);
  expect(f.shells[0]!.close).toHaveBeenCalledOnce();
  expect((await f.service.listTerminals('other-server')).terminals[0]?.id).toBe(other.id);
  expect(f.pool.disconnect).not.toHaveBeenCalled();
});

it('PTY保留512KiB且分段读取游标只推进实际返回数据，陈旧游标显式重置', async () => {
  const f = fixture();
  const terminal = await f.service.createTerminal('my-server', { cols: 80, rows: 24 });
  f.shells[0]!.emit('data', Buffer.alloc(600 * 1024, 65));
  const first = await f.service.readTerminal('my-server', terminal.id, 0);
  expect(first).toMatchObject({ reset: true, start: 88 * 1024, nextSeq: 152 * 1024, seq: 600 * 1024 });
  expect(Buffer.from(first.data, 'base64')).toHaveLength(64 * 1024);
  const second = await f.service.readTerminal('my-server', terminal.id, first.nextSeq);
  expect(second).toMatchObject({ reset: false, nextSeq: 216 * 1024 });
  await expect(f.service.readTerminal('my-server', terminal.id, second.seq + 1)).rejects.toMatchObject({
    code: 'invalid_request',
  });
});

it('并发创建先占名额，认证变化关闭所属PTY，插件停用清理后可重新启用', async () => {
  const f = fixture();
  let resume!: () => void;
  f.setOpenBarrier(
    new Promise<void>((resolve) => {
      resume = resolve;
    }),
  );
  const pending = Array.from({ length: 6 }, () => f.service.createTerminal('my-server', { cols: 80, rows: 24 }));
  const completed = Promise.allSettled(pending);
  await expect(f.service.createTerminal('my-server', { cols: 80, rows: 24 })).rejects.toMatchObject({
    code: 'terminal_limit',
  });
  resume();
  expect((await completed).every((result) => result.status === 'fulfilled')).toBe(true);
  f.invalidate('my-server');
  expect((await f.service.listTerminals('my-server')).terminals).toEqual([]);
  expect(f.shells.every((channel) => channel.closed)).toBe(true);
  f.disable();
  f.service.dispose();
  await expect(f.service.listDirectory('my-server')).rejects.toMatchObject({ code: 'plugin_disabled' });
  f.enable();
  expect((await f.service.listDirectory('my-server')).path).toBe('/home/demo');
});

it('目录与预览只读且有上限，二进制内容不渲染为文本', async () => {
  const f = fixture();
  f.setDirectoryCount(401);
  const directory = await f.service.listDirectory('my-server');
  expect(directory.entries).toHaveLength(400);
  expect(directory).toMatchObject({ serverId: 'my-server', path: '/home/demo', truncated: true });
  f.setFile(Buffer.alloc(300 * 1024, 65));
  const preview = await f.service.preview('my-server', '/home/demo/text');
  expect(preview).toMatchObject({ size: 300 * 1024, truncated: true, binary: false });
  expect(Buffer.byteLength(preview.text)).toBe(256 * 1024);
  expect(f.reads.every((read) => read.position + read.length <= 256 * 1024)).toBe(true);
  f.setFile(Buffer.from([65, 0, 66]));
  expect(await f.service.preview('my-server', '/home/demo/text')).toMatchObject({ binary: true, text: '' });
  expect(f.sftps.every((channel) => channel.end.mock.calls.length > 0)).toBe(true);
});

it('进程exit之后拒绝输入，仍等通道close收齐尾部输出', async () => {
  const f = fixture();
  const terminal = await f.service.createTerminal('my-server', { cols: 80, rows: 24 });
  f.shells[0]!.emit('exit', 7, 'TERM');
  await expect(f.service.writeTerminal('my-server', terminal.id, 'YQ==')).rejects.toMatchObject({
    code: 'terminal_exited',
  });
  expect((await f.service.readTerminal('my-server', terminal.id, 0)).exited).toBe(false);
  f.shells[0]!.emit('data', Buffer.from('尾部'));
  f.shells[0]!.emit('close');
  const result = await f.service.readTerminal('my-server', terminal.id, 0);
  expect(result).toMatchObject({ exited: true, exitCode: 7, signal: 'TERM' });
  expect(Buffer.from(result.data, 'base64').toString()).toBe('尾部');
});

it('总量32包含在途创建，停用时释放已经打开和迟到的通道', async () => {
  const f = fixture();
  let resume!: () => void;
  f.setOpenBarrier(
    new Promise<void>((resolve) => {
      resume = resolve;
    }),
  );
  const pending = Promise.allSettled(
    Array.from({ length: 32 }, (_, index) =>
      f.service.createTerminal(`server-${Math.floor(index / 6)}`, { cols: 80, rows: 24 }),
    ),
  );
  await expect(f.service.createTerminal('extra-server', { cols: 80, rows: 24 })).rejects.toMatchObject({
    code: 'terminal_limit',
  });
  await vi.waitFor(() => expect(f.shells).toHaveLength(32));
  f.disable();
  f.service.dispose();
  resume();
  expect((await pending).every((item) => item.status === 'rejected')).toBe(true);
  expect(f.shells.every((channel) => channel.closed)).toBe(true);
  expect(f.pool.disconnect).not.toHaveBeenCalled();
});

it('预览过程中认证失效不返回旧内容，只关闭本次SFTP通道', async () => {
  const f = fixture();
  let resume!: () => void;
  f.setReadBarrier(
    new Promise<void>((resolve) => {
      resume = resolve;
    }),
  );
  const pending = f.service.preview('my-server', '/home/demo/text').then(
    () => 'leaked',
    () => 'rejected',
  );
  await vi.waitFor(() => expect(f.reads).toHaveLength(1));
  f.invalidate('my-server');
  resume();
  expect(await pending).toBe('rejected');
  expect(f.sftps[0]!.end).toHaveBeenCalled();
  expect(f.pool.disconnect).not.toHaveBeenCalled();
});

it('SFTP在预览回调前断开会立即结束读取，不等超时或迟到内容', async () => {
  const f = fixture();
  let resume!: () => void;
  f.setReadBarrier(
    new Promise<void>((resolve) => {
      resume = resolve;
    }),
  );
  const pending = f.service.preview('my-server', '/home/demo/text').then(
    () => 'returned',
    () => 'rejected',
  );
  await vi.waitFor(() => expect(f.reads).toHaveLength(1));
  f.sftps[0]!.emit('close');
  const result = await Promise.race([
    pending,
    new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 30)),
  ]);
  resume();
  await pending;
  expect(result).toBe('rejected');
});

it('外部配置变化即使未增加认证代次也关闭旧PTY并拒绝写入', async () => {
  const f = fixture();
  const terminal = await f.service.createTerminal('my-server', { cols: 80, rows: 24 });
  f.externalIdentityChange();
  await expect(f.service.writeTerminal('my-server', terminal.id, 'YQ==')).rejects.toMatchObject({
    code: 'target_changed',
  });
  expect(f.shells[0]!.closed).toBe(true);
  expect(f.shells[0]!.write.mock.calls.some(([value]) => Buffer.isBuffer(value))).toBe(false);
  expect((await f.service.listTerminals('my-server')).terminals).toEqual([]);
});
