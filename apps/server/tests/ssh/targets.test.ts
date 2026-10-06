import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerTargets, serverHostConfig } from '../../src/ssh/targets';
import { createConnectionResolver } from '../../src/ssh/connection';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const input = { name: '演示服务器', hostname: 'Example.invalid', username: 'demo', keyFile: '~/.ssh/demo-key' };
describe('独立手动服务器表', () => {
  it('并发保存复用别名，重启后统一解析实际目标且不改SSH config', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'manual-target-'));
    temps.push(configDir);
    const homeDir = path.join(configDir, 'home');
    const targets = createServerTargets({ configDir, homeDir });
    const [first, second] = await Promise.all([targets.save(input), targets.save({ ...input, name: '新名称' })]);
    expect(second.alias).toBe(first.alias);
    const restarted = createServerTargets({ configDir, homeDir });
    expect(await restarted.list()).toEqual([second]);
    const resolver = createConnectionResolver({
      homeDir,
      lookupHost: async (alias) => {
        const saved = await restarted.get(alias);
        return saved ? serverHostConfig(saved) : undefined;
      },
      readFile: async (file) => {
        if (file === second.keyFile) return Buffer.from('fixture-key');
        const error = new Error('不存在') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });
    expect(await resolver.resolve({ alias: second.alias, authMode: 'key' })).toMatchObject({
      alias: second.alias,
      hostname: 'example.invalid',
      port: 22,
      username: 'demo',
      keyFile: path.join(homeDir, '.ssh', 'demo-key'),
    });
    expect(await readFile(path.join(configDir, 'servers.json'), 'utf8')).not.toContain('fixture-key');
    await expect(readFile(path.join(homeDir, '.ssh', 'config'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('拒绝密码字段、控制字符、非法端口和相对私钥，不留下配置', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'manual-invalid-'));
    temps.push(configDir);
    const targets = createServerTargets({ configDir });
    for (const patch of [
      { password: 'fixture-secret' },
      { hostname: 'bad\nhost' },
      { port: 0 },
      { keyFile: 'relative-key' },
    ]) {
      await expect(targets.save({ ...input, ...patch })).rejects.toMatchObject({ code: 'invalid_target' });
    }
    expect(await targets.list()).toEqual([]);
  });
});
