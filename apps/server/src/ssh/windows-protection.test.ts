import { describe, expect, it, vi } from 'vitest';
import { createWindowsProtector } from './windows-protection';
import { runProcess } from '../sync/process';

const entropy = Buffer.alloc(32, 7);
describe('Windows 当前用户系统加密', () => {
  it.runIf(process.platform === 'win32')('真实 DPAPI 往返，秘密不进入命令行', async () => {
    const calls: string[][] = [];
    const protector = createWindowsProtector({
      run: (exe, args, options) => {
        calls.push([exe, ...args]);
        return runProcess(exe, args, options);
      },
    });
    const data = Buffer.from('中文-fixture-secret', 'utf8');
    const encrypted = await protector.protect(data, entropy);
    expect(encrypted.includes(data)).toBe(false);
    expect(await protector.unprotect(encrypted, entropy)).toEqual(data);
    expect(calls.flat().join(' ')).not.toContain(data.toString('utf8'));
    await expect(protector.unprotect(encrypted, Buffer.alloc(32, 8))).rejects.toMatchObject({
      code: 'credential_storage_failed',
    });
  });
  it('不支持的平台明确拒绝，不回退明文', async () => {
    const run = vi.fn();
    const protector = createWindowsProtector({ platform: 'linux', run });
    expect(protector.available).toBe(false);
    await expect(protector.protect(Buffer.from('fixture-secret'), entropy)).rejects.toMatchObject({
      code: 'password_storage_unavailable',
    });
    expect(run).not.toHaveBeenCalled();
  });
  it('系统失败不回显原始诊断或输入', async () => {
    const run = vi.fn(async () => ({ stdout: Buffer.alloc(0), stderr: Buffer.from('private-content'), exitCode: 1 }));
    const protector = createWindowsProtector({ platform: 'win32', run });
    await expect(protector.protect(Buffer.from('fixture-secret'), entropy)).rejects.toThrow('系统加密');
    expect(run.mock.calls).toHaveLength(1);
  });
});
