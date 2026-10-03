// 仅用合成数据诊断 Windows CI 的系统加密阻塞；不输出环境值、明文或任意子进程诊断。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';

const root = process.env.SystemRoot ?? 'C:\\Windows';
const executable = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const script = [
  "$ErrorActionPreference='Stop'",
  "[Console]::Error.WriteLine('script:start')",
  "try { [Console]::Error.WriteLine('assembly:before'); Add-Type -AssemblyName System.Security; [Console]::Error.WriteLine('assembly:after')",
  "[Console]::Error.WriteLine('stdin:before'); $json=[Console]::In.ReadToEnd(); [Console]::Error.WriteLine('stdin:after')",
  '$payload=ConvertFrom-Json $json; $data=[Convert]::FromBase64String($payload.data); $entropy=[Convert]::FromBase64String($payload.entropy)',
  "[Console]::Error.WriteLine('protect:before'); $result=[System.Security.Cryptography.ProtectedData]::Protect($data,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Error.WriteLine('protect:after')",
  "[Console]::Error.WriteLine('unprotect:before'); $plain=[System.Security.Cryptography.ProtectedData]::Unprotect($result,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Error.WriteLine('unprotect:after')",
  "if ([Convert]::ToBase64String($plain) -ne $payload.data) { throw 'roundtrip mismatch' }; [Console]::Out.Write('roundtrip:ok'); [Console]::Error.WriteLine('script:end') } catch { [Console]::Error.WriteLine('caught:'+ $_.Exception.GetType().FullName); exit 1 }",
].join('; ');
type Stage = { ms: number; event: string; code?: string | number | null };

async function check(label: string, env: NodeJS.ProcessEnv) {
  const started = performance.now();
  const events: Stage[] = [];
  const record = (event: string, code?: Stage['code']) => {
    events.push({ ms: Math.round(performance.now() - started), event, code });
  };
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.on('spawn', () => record('node:spawn'));
  child.on('error', (error: NodeJS.ErrnoException) => record('node:error', error.code));
  child.stdin.on('finish', () => record('node:stdin-finish'));
  child.stdin.on('error', (error: NodeJS.ErrnoException) => record('node:stdin-error', error.code));
  const output = createInterface({ input: child.stdout });
  output.on('line', (line) => {
    if (line === 'roundtrip:ok') record(line);
  });
  const diagnostics = createInterface({ input: child.stderr });
  diagnostics.on('line', (line) => {
    if (/^(?:script|assembly|stdin|protect|unprotect|caught):[\w.]+$/.test(line)) record(line);
  });
  child.on('exit', (code, signal) => record('node:exit', code ?? signal));
  const timer = setTimeout(() => {
    record('node:timeout');
    child.kill('SIGKILL');
  }, 10_000);
  child.stdin.end(
    JSON.stringify({
      data: Buffer.from('diagnostic-fixture').toString('base64'),
      entropy: Buffer.alloc(32, 7).toString('base64'),
    }),
  );
  await new Promise<void>((resolve) =>
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      record('node:close', code ?? signal);
      resolve();
    }),
  );
  return { label, events };
}

if (process.platform === 'win32') {
  const baseEnv = {
    SystemRoot: root,
    WINDIR: root,
    PATH: process.env.PATH,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  const profileEnv: NodeJS.ProcessEnv = { ...baseEnv };
  for (const name of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PSModulePath']) {
    if (process.env[name]) profileEnv[name] = process.env[name];
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        probes: [await check('product-env', baseEnv), await check('with-profile-paths', profileEnv)],
      },
      null,
      2,
    ),
  );
}
