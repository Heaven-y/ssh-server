// 拼装在服务器上执行的命令。所有参数都用 POSIX 单引号转义，避免注入。
//
// 旧的 peek 命令与 EXEC_* 超时常量随「Agent 在服务器上执行」那条链路一并删除，已无调用方。

/** stdout、stderr 各自最多保留的字节数；手工冒烟脚本也用它。 */
export const OUTPUT_CAP_BYTES = 200_000;

/** POSIX 单引号转义：'it'\''s' */
export function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function assertNoLineBreak(s: string, what: string): void {
  if (/[\r\n\0]/.test(s)) throw new Error(`${what}不能包含换行或 NUL 字符`);
}

/** 进入服务器目录；~ 开头时写成 "$HOME"/'其余部分'，让远端展开家目录 */
function cdPrefix(remoteRoot: string): string {
  assertNoLineBreak(remoteRoot, '服务器目录');
  if (remoteRoot === '~') return 'cd "$HOME"';
  if (remoteRoot.startsWith('~/')) return `cd "$HOME"/${sq(remoteRoot.slice(2))}`;
  return `cd ${sq(remoteRoot)}`;
}

/** 在服务器目录下用登录 shell 执行命令（加载 .bash_profile / conda 等环境），并限制运行时长 */
export function buildRemoteCommand(remoteRoot: string, command: string, timeoutSec: number): string {
  if (!Number.isInteger(timeoutSec) || timeoutSec <= 0) throw new Error('超时必须是正整数秒');
  return `${cdPrefix(remoteRoot)} && exec timeout ${timeoutSec} bash -lc ${sq(command)}`;
}
