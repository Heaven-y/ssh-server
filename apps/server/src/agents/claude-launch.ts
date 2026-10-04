import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'));
function preferMusl() {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return report !== undefined && report.header?.glibcVersionRuntime === undefined;
}
function candidates() {
  const base = '@anthropic-ai/claude-agent-sdk';
  const platform: string = process.platform;
  if (platform === 'android') return [`${base}-linux-${process.arch}-android/claude`];
  if (platform === 'linux') {
    const glibc = `${base}-linux-${process.arch}/claude`;
    const musl = `${base}-linux-${process.arch}-musl/claude`;
    return preferMusl() ? [musl, glibc] : [glibc, musl];
  }
  return [`${base}-${platform}-${process.arch}/${platform === 'win32' ? 'claude.exe' : 'claude'}`];
}
/** 与固定SDK 0.3.286的候选顺序及解析基准一致，对话和版本检测共用。 */
export function resolveClaudeExecutable(): string {
  for (const candidate of candidates()) {
    try {
      const executable = sdkRequire.resolve(candidate);
      if (existsSync(executable)) return executable;
    } catch {
      /* 可选平台包不存在时继续使用SDK的下一候选。 */
    }
  }
  throw new Error('找不到Claude Code原生程序，请检查本机SDK安装。');
}
