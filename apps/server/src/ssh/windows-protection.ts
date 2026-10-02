// Windows 当前用户 DPAPI；输入/输出经 stdin/stdout，命令行只有固定脚本。
import path from 'node:path';
import { runProcess, type ProcessRunner } from '../sync/process';
import { CredentialStorageError, storageFailure } from './credential-storage-error';

export type SecretProtector = {
  available: boolean;
  protect(data: Buffer, entropy: Buffer): Promise<Buffer>;
  unprotect(data: Buffer, entropy: Buffer): Promise<Buffer>;
};
type Deps = { platform?: NodeJS.Platform; run?: ProcessRunner };
function protectionScript(method: 'Protect' | 'Unprotect'): string {
  return (
    `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; ` +
    `$payload=ConvertFrom-Json ([Console]::In.ReadToEnd()); ` +
    `$data=[Convert]::FromBase64String($payload.data); $entropy=[Convert]::FromBase64String($payload.entropy); ` +
    `$result=[System.Security.Cryptography.ProtectedData]::${method}($data,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
    `[Console]::Write([Convert]::ToBase64String($result)); } catch { [Console]::Error.Write('system protection failed'); exit 1; }`
  );
}
export function createWindowsProtector(deps: Deps = {}): SecretProtector {
  const available = (deps.platform ?? process.platform) === 'win32';
  const run = deps.run ?? runProcess;
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const executable = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  async function transform(method: 'Protect' | 'Unprotect', data: Buffer, entropy: Buffer): Promise<Buffer> {
    if (!available)
      throw new CredentialStorageError(
        'password_storage_unavailable',
        '当前平台不支持 Windows 系统加密保存，仍可使用临时密码',
      );
    try {
      const result = await run(
        executable,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', protectionScript(method)],
        {
          input: JSON.stringify({ data: data.toString('base64'), entropy: entropy.toString('base64') }),
          env: { SystemRoot: root, WINDIR: root, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP },
          timeoutMs: 10_000,
          outputCap: 32_768,
        },
      );
      const output = result.stdout.toString('ascii').trim();
      if (result.exitCode !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) throw storageFailure();
      const value = Buffer.from(output, 'base64');
      if (value.toString('base64') !== output) throw storageFailure();
      return value;
    } catch {
      throw storageFailure();
    }
  }
  return {
    available,
    protect: (data, entropy) => transform('Protect', data, entropy),
    unprotect: (data, entropy) => transform('Unprotect', data, entropy),
  };
}
