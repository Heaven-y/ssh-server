import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServerTargets, serverHostConfig } from '../../src/ssh/targets';
import { createConnectionResolver } from '../../src/ssh/connection';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const input = {
  name: '演示服务器',
  hostname: 'Example.invalid',
  username: 'demo',
  authMode: 'key',
  keyFile: '~/.ssh/demo-key',
};
async function fixture() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'manual-target-'));
  temps.push(configDir);
  const homeDir = path.join(configDir, 'home');
  return { configDir, homeDir, targets: createServerTargets({ configDir, homeDir }) };
}
describe('独立手动服务器表', () => {
  it('新增不覆盖已有档案，重启后统一解析实际目标且不改SSH config', async () => {
    const { configDir, homeDir, targets } = await fixture();
    const first = await targets.save(input);
    await expect(targets.save({ ...input, name: '新名称' })).rejects.toMatchObject({ code: 'target_duplicate' });
    const restarted = createServerTargets({ configDir, homeDir });
    expect(await restarted.list()).toEqual([first]);
    const resolver = createConnectionResolver({
      homeDir,
      lookupHost: async (alias) => {
        const saved = await restarted.get(alias);
        return saved ? serverHostConfig(saved) : undefined;
      },
      readFile: async (file) => {
        if (file === first.keyFile) return Buffer.from('fixture-key');
        const error = new Error('不存在') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });
    expect(await resolver.resolve({ alias: first.alias })).toMatchObject({
      alias: first.alias,
      hostname: 'example.invalid',
      port: 22,
      username: 'demo',
      authMode: 'key',
      keyFile: path.join(homeDir, '.ssh', 'demo-key'),
    });
    expect(await readFile(path.join(configDir, 'servers.json'), 'utf8')).not.toContain('fixture-key');
    await expect(readFile(path.join(homeDir, '.ssh', 'config'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('全记录比较串行更新和删除，旧快照不覆盖新值', async () => {
    const { targets } = await fixture();
    const first = await targets.save(input);
    const results = await Promise.allSettled([
      targets.update(first.alias, { ...input, name: '新名称' }, first),
      targets.update(first.alias, { ...input, name: '竞争修改' }, first),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    await expect(targets.remove(first.alias, first)).rejects.toMatchObject({ code: 'target_changed' });
    const current = (await targets.get(first.alias))!;
    await targets.remove(first.alias, current);
    expect(await targets.list()).toEqual([]);
  });
  it('写盘前的保护失败时保留原记录', async () => {
    const { targets } = await fixture();
    const first = await targets.save(input);
    await expect(
      targets.update(first.alias, { ...input, name: '不能保存' }, first, async () => {
        throw new Error('活动任务');
      }),
    ).rejects.toThrow('活动任务');
    expect(await targets.get(first.alias)).toEqual(first);
  });
  it('拒绝旧存储结构并保留原文件', async () => {
    const { configDir, targets } = await fixture();
    const first = await targets.save(input);
    const { authMode: _authMode, ...old } = first;
    const text = JSON.stringify([old]);
    const file = path.join(configDir, 'servers.json');
    await writeFile(file, text, 'utf8');
    await expect(targets.list()).rejects.toMatchObject({ code: 'target_storage_failed' });
    expect(await readFile(file, 'utf8')).toBe(text);
  });
  it('拒绝密码字段、控制字符、非法端口和相对私钥，不留下配置', async () => {
    const { targets } = await fixture();
    for (const patch of [
      { password: 'fixture-secret' },
      { hostname: 'bad\nhost' },
      { port: 0 },
      { keyFile: 'relative-key' },
      { authMode: undefined },
    ]) {
      await expect(targets.save({ ...input, ...patch })).rejects.toMatchObject({ code: 'invalid_target' });
    }
    expect(await targets.list()).toEqual([]);
  });
});
