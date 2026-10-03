import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWindowsProtector } from '../../src/ssh/windows-protection';
import { runProcess, type ProcessRunner } from '../../src/sync/process';

const entropy = Buffer.alloc(32, 7);
describe('Windows 当前用户系统加密', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('传递模块加载所需路径，不继承其他服务凭据', async () => {
    const profile = path.join(os.tmpdir(), 'fixture-profile');
    const paths = {
      USERPROFILE: profile,
      APPDATA: path.join(profile, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(profile, 'AppData', 'Local'),
      PSModulePath: path.join(profile, 'Modules'),
    };
    for (const [name, value] of Object.entries(paths)) vi.stubEnv(name, value);
    vi.stubEnv('SSH_SERVER_FIXTURE_SECRET', 'fixture-service-secret');
    const run = vi.fn<ProcessRunner>().mockResolvedValue({
      stdout: Buffer.from(Buffer.from('fixture-ciphertext').toString('base64')),
      stderr: Buffer.alloc(0),
      exitCode: 0,
    });
    const protector = createWindowsProtector({ platform: 'win32', run });

    await protector.protect(Buffer.from('fixture-secret'), entropy);

    expect(run).toHaveBeenCalledOnce();
    const childEnv = run.mock.calls[0]?.[2].env;
    expect(childEnv).toMatchObject(paths);
    expect(childEnv).not.toHaveProperty('SSH_SERVER_FIXTURE_SECRET');
  });

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
