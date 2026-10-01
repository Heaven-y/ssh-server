// 拼装在服务器上执行的命令。所有参数都用 POSIX 单引号转义，避免注入。

export const EXEC_DEFAULT_TIMEOUT_SEC = 600;
export const EXEC_MAX_TIMEOUT_SEC = 3600;
/** 本地超时比远端 timeout 多出的宽限时间，留给远端自行结束进程 */
export const EXEC_GRACE_SEC = 30;
/** stdout、stderr 各自最多保留的字节数 */
export const OUTPUT_CAP_BYTES = 200_000;

const PEEK_MAX_LINES = 200;
const PEEK_DEFAULT_LINES = 50;
const PEEK_DU_TIMEOUT_SEC = 30;

export type PeekAction = 'stat' | 'head' | 'tail' | 'du';

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

/** 查看文件或目录信息（不经过黑名单，命令完全由这里拼装） */
export function buildPeekCommand(remoteRoot: string, path: string, action: PeekAction, lines?: number): string {
  assertNoLineBreak(path, '路径');
  const n = lines ?? PEEK_DEFAULT_LINES;
  if (!Number.isInteger(n) || n < 1 || n > PEEK_MAX_LINES) throw new Error(`行数必须在 1 到 ${PEEK_MAX_LINES} 之间`);

  const target = sq(path);
  const body = {
    stat: `stat -c ${sq('%F|%s|%y|%n')} -- ${target}`,
    head: `head -n ${n} -- ${target}`,
    tail: `tail -n ${n} -- ${target}`,
    du: `timeout ${PEEK_DU_TIMEOUT_SEC} du -sh -- ${target}`,
  }[action];
  return `${cdPrefix(remoteRoot)} && ${body}`;
}
