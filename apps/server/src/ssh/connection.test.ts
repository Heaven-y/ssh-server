import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConnectionResolver } from './connection';

const HOME = path.resolve('test-home');
const SSH = path.join(HOME, '.ssh');

function fixture() {
  const files = new Map<string, Buffer>([
    [path.join(SSH, 'config'), Buffer.from('Host my-server\n HostName example.invalid\n Port 2222\n User demo\n')],
    [path.join(SSH, 'known_hosts'), Buffer.from('example.invalid ssh-ed25519 AAAA\n')],
    [path.join(SSH, 'id_ed25519'), Buffer.from('fixture-private-key')],
  ]);
  const reads: string[] = [];
  const resolver = createConnectionResolver({
    homeDir: HOME,
    readFile: async (file) => {
      reads.push(file);
      const value = files.get(file);
      if (!value) throw new Error('ENOENT');
      return value;
    },
  });
  return { resolver, files, reads };
}

describe('SSH 共用连接解析器', () => {
  it('旧 Host 输入解析私钥和同一 known_hosts 路径', async () => {
    const { resolver } = fixture();
    const value = await resolver.resolve('my-server');
    expect(value).toMatchObject({
      alias: 'my-server',
      hostname: 'example.invalid',
      port: 2222,
      username: 'demo',
      authMode: 'key',
      keyFile: path.join(SSH, 'id_ed25519'),
      knownHostsFile: path.join(SSH, 'known_hosts'),
    });
    expect(value.privateKey?.toString()).toBe('fixture-private-key');
    expect(value).not.toHaveProperty('password');
  });

  it('密码模式未认证时不读取私钥', async () => {
    const { resolver, reads } = fixture();
    await expect(resolver.resolve({ alias: 'my-server', authMode: 'password' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
    expect(reads).not.toContain(path.join(SSH, 'id_ed25519'));
  });

  it('密码仅用于绑定的目标，替换后缓存身份变化', async () => {
    const { resolver } = fixture();
    await resolver.setPassword('my-server', 'first-secret');
    const first = await resolver.resolve({ alias: 'my-server', authMode: 'password' });
    expect(first.password).toBe('first-secret');
    expect(first).not.toHaveProperty('privateKey');
    await resolver.setPassword('my-server', 'second-secret');
    const second = await resolver.resolve({ alias: 'my-server', authMode: 'password' });
    expect(second.password).toBe('second-secret');
    expect(second.cacheKey).not.toBe(first.cacheKey);
    expect(second.cacheKey).not.toContain('secret');
  });

  it('修改 Host 地址后清除旧密码，改回也不能恢复', async () => {
    const { resolver, files } = fixture();
    await resolver.setPassword('my-server', 'test-secret');
    const before = files.get(path.join(SSH, 'config'))!;
    files.set(
      path.join(SSH, 'config'),
      Buffer.from('Host my-server\n HostName other.invalid\n Port 2222\n User demo\n'),
    );
    await expect(resolver.resolve({ alias: 'my-server', authMode: 'password' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
    files.set(path.join(SSH, 'config'), before);
    await expect(resolver.resolve({ alias: 'my-server', authMode: 'password' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
  });

  it('断开与退出清除密码，错误中没有密码', async () => {
    const { resolver } = fixture();
    await resolver.setPassword('my-server', 'test-secret');
    resolver.clear('my-server');
    await expect(resolver.resolve({ alias: 'my-server', authMode: 'password' })).rejects.toThrow('重新输入');
    await resolver.setPassword('my-server', 'test-secret');
    resolver.clearAll();
    await expect(resolver.resolve({ alias: 'my-server', authMode: 'password' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
  });

  it('不支持的跳板选项明确拒绝，而非静默直连', async () => {
    const { resolver, files } = fixture();
    files.set(path.join(SSH, 'config'), Buffer.from('Host my-server\n HostName example.invalid\n ProxyJump jump\n'));
    await expect(resolver.resolve('my-server')).rejects.toMatchObject({ code: 'unsupported_config' });
  });

  it('私钥和 known_hosts 修改后缓存身份变化', async () => {
    const { resolver, files } = fixture();
    const before = await resolver.resolve('my-server');
    files.set(path.join(SSH, 'id_ed25519'), Buffer.from('changed-key'));
    expect((await resolver.resolve('my-server')).cacheKey).not.toBe(before.cacheKey);
  });
  it.each(['disconnect', 'shutdown'] as const)('配置读取中 %s 后迟到的密码不会复活', async (action) => {
    const { files } = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting = true;
    const resolver = createConnectionResolver({
      homeDir: HOME,
      readFile: async (file) => {
        if (waiting) await gate;
        const value = files.get(file);
        if (!value) throw new Error('ENOENT');
        return value;
      },
    });
    const setting = resolver.setPassword('my-server', 'late-secret');
    if (action === 'disconnect') resolver.clear('my-server');
    else resolver.clearAll();
    waiting = false;
    release();
    await expect(setting).rejects.toMatchObject({ code: 'connection_cancelled' });
    await expect(resolver.resolve({ alias: 'my-server', authMode: 'password' })).rejects.toMatchObject({
      code: 'credentials_required',
    });
  });
  it.each(['line\nsecond', 'line\rsecond', 'nul\0byte'])('拒绝同步子进程不能完整传递的密码', async (password) => {
    const { resolver } = fixture();
    await expect(resolver.setPassword('my-server', password)).rejects.toMatchObject({ code: 'credentials_required' });
  });
});
