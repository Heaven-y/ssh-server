import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasswordStore } from '../../src/ssh/password-store';
import type { SecretProtector } from '../../src/ssh/windows-protection';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function encryptedFixture(): SecretProtector {
  const key = randomBytes(32);
  return {
    available: true,
    protect(data, entropy) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(entropy);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
    },
    unprotect(data, entropy) {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAAD(entropy);
      decipher.setAuthTag(data.subarray(12, 28));
      return Promise.resolve(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
    },
  };
}
async function fixture() {
  const configDir = await mkdtemp(path.join(process.env.PI_SCRATCH_DIR ?? os.tmpdir(), 'saved-password-test-'));
  roots.push(configDir);
  const protector = encryptedFixture();
  const store = createPasswordStore({ configDir, protector });
  return { configDir, protector, store, directory: path.join(configDir, 'credentials') };
}
const identity = JSON.stringify(['example.invalid', 2222, 'demo']);
const filename = (target: string) => createHash('sha256').update(target).digest('hex') + '.json';
describe('独立的加密 SSH 密码存储', () => {
  it('保存、重建实例后读取、忘记；文件和名称不含明文', async () => {
    const { store, configDir, protector, directory } = await fixture();
    expect(await store.load(identity)).toBeUndefined();
    await store.save(identity, '中文-fixture-secret');
    expect(await store.has(identity)).toBe(true);
    const files = await readdir(directory);
    expect(files).toEqual([filename(identity)]);
    const disk = await readFile(path.join(directory, files[0]!), 'utf8');
    expect(disk).not.toContain('fixture-secret');
    expect(disk).not.toContain('example.invalid');
    const restarted = createPasswordStore({ configDir, protector });
    expect(await restarted.load(identity)).toBe('中文-fixture-secret');
    await restarted.forget(identity);
    expect(await restarted.has(identity)).toBe(false);
    expect(await restarted.load(identity)).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });
  it('密文不能移到另一目标使用，错误不含凭据', async () => {
    const { store, directory } = await fixture();
    await store.save(identity, 'fixture-secret');
    const other = JSON.stringify(['other.invalid', 2222, 'demo']);
    await copyFile(path.join(directory, filename(identity)), path.join(directory, filename(other)));
    await expect(store.load(other)).rejects.toMatchObject({ code: 'credential_storage_failed' });
  });
  it('忘记期间的迟到保存不能重新建立凭据文件', async () => {
    const { store, protector, directory } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const protect = protector.protect.bind(protector);
    const seal = vi.spyOn(protector, 'protect').mockImplementation(async (data, entropy) => {
      await gate;
      return protect(data, entropy);
    });
    const saving = store.save(identity, 'late-secret');
    const cancelled = expect(saving).rejects.toMatchObject({ code: 'credential_operation_cancelled' });
    await vi.waitFor(() => expect(seal).toHaveBeenCalled());
    const forgetting = store.forget(identity);
    release();
    await cancelled;
    await forgetting;
    expect(await readdir(directory)).toEqual([]);
  });
  it('连接代次失效时不保存；系统失败不留下明文或临时文件', async () => {
    const { store, protector, directory } = await fixture();
    await expect(store.save(identity, 'fixture-secret', () => false)).rejects.toMatchObject({
      code: 'credential_operation_cancelled',
    });
    vi.spyOn(protector, 'protect').mockRejectedValueOnce(new Error('fixture-secret-in-system-error'));
    await expect(store.save(identity, 'fixture-secret')).rejects.toMatchObject({ code: 'credential_storage_failed' });
    expect(await readdir(directory)).toEqual([]);
  });
  it('损坏的保存项不能当作有效密码', async () => {
    const { store, directory } = await fixture();
    await store.save(identity, 'fixture-secret');
    await writeFile(path.join(directory, filename(identity)), '{private-content');
    await expect(store.load(identity)).rejects.toMatchObject({ code: 'credential_storage_failed' });
  });
  it('原子替换期间认证失效时回滚原保存项，不遗留迟到的新密码', async () => {
    const { store, directory } = await fixture();
    await store.save(identity, 'previous-secret');
    const file = path.join(directory, filename(identity));
    const before = await readFile(file, 'utf8');
    await expect(
      store.save(identity, 'late-secret', async () => (await readFile(file, 'utf8')) === before),
    ).rejects.toMatchObject({ code: 'credential_operation_cancelled' });
    expect(await store.load(identity)).toBe('previous-secret');
    expect(await readdir(directory)).toEqual([filename(identity)]);
  });
});
