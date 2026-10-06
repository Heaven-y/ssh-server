// SSH 连通性冒烟检查：在服务器上执行 hostname（只读）。
// 用法：node --import tsx scripts/dev/ssh-smoke.ts <Host> [--show]
// 默认不打印主机名本身（只打印长度与哈希前缀），避免把服务器信息带进日志；加 --show 才显示。
import { createHash } from 'node:crypto';
import { createSshPool } from '../../apps/server/src/ssh/pool';
import { buildRemoteCommand, OUTPUT_CAP_BYTES } from '../../apps/server/src/ssh/remote-command';

const [alias, flag] = process.argv.slice(2);
if (!alias) {
  console.error('用法：node --import tsx scripts/dev/ssh-smoke.ts <Host> [--show]');
  process.exit(2);
}

const pool = createSshPool();
try {
  const r = await pool.exec({ alias, authMode: 'key' }, buildRemoteCommand('~', 'hostname', 30), {
    localTimeoutMs: 60_000,
    outputCap: OUTPUT_CAP_BYTES,
  });
  const name = r.stdout.trim();
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 8);
  console.log(`退出码：${r.exitCode}，耗时 ${r.durationMs} ms，主机名长度 ${name.length}，sha256 前缀 ${digest}`);
  if (flag === '--show') console.log(`主机名：${name}`);
  if (r.stderr.trim()) console.log(`stderr：${r.stderr.trim()}`);
  process.exitCode = r.exitCode === 0 && name.length > 0 ? 0 : 1;
} catch (e) {
  console.error(`失败：${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  pool.dispose();
}
