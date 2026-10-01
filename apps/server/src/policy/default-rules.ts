// 默认命令黑名单规则。只防误操作，不能防有意绕过（编码、写进脚本再执行等）。

export type PolicyContext = {
  /** 工作区服务器目录，如 ~/projects/demo */
  remoteRoot: string;
  /** 工作区停用的规则 id */
  disabledRules?: string[];
};

export type Rule = {
  id: string;
  reason: string;
  /** 针对单个片段：argv[0] 是去掉包装命令后的程序名 */
  match?(argv: string[], ctx: PolicyContext): boolean;
  /** 针对整条原始命令（用于无法按片段识别的形式） */
  matchRaw?(command: string): boolean;
};

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const isShortOpt = (a: string) => /^-[A-Za-z]+$/.test(a);

/** 是否带递归选项：-r、-R、--recursive，或组合短选项如 -rf */
function hasRecursive(args: string[]): boolean {
  return args.some((a) => a === '--recursive' || (isShortOpt(a) && /[rR]/.test(a)));
}

/** 统一路径写法：$HOME / ${HOME} → ~，去掉开头的 ./ 和结尾的 /（根目录 / 除外） */
function normalizeTarget(p: string): string {
  let s = p.replace(/^\$\{HOME\}/, '~').replace(/^\$HOME/, '~');
  if (s.startsWith('./')) s = s.slice(2);
  while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s === '' ? '.' : s;
}

/** rm 的目标参数（跳过选项；`--` 之后全部视为目标） */
function rmTargets(args: string[]): string[] {
  const out: string[] = [];
  let afterDashDash = false;
  for (const a of args) {
    if (!afterDashDash && a === '--') {
      afterDashDash = true;
      continue;
    }
    if (afterDashDash || !a.startsWith('-')) out.push(a);
  }
  return out;
}

function isDangerousRmTarget(target: string, remoteRoot: string): boolean {
  const t = normalizeTarget(target);
  const root = normalizeTarget(remoteRoot);
  const dangerous = new Set(['/', '/*', '~', '~/*', '*', '.', '..', '../*', root, `${root}/*`]);
  return dangerous.has(t);
}

/** 会写入、移动或删除文件的程序 */
const WRITE_PROGRAMS = new Set(['rm', 'mv', 'cp', 'tee', 'truncate', 'ln', 'chmod', 'chown', 'install', 'dd']);

function writesAuthorizedKeys(argv: string[]): boolean {
  const idx = argv.findIndex((a, i) => i > 0 && a.includes('authorized_keys'));
  if (idx === -1) return false;
  const prog = base(argv[0]!);
  const prev = argv[idx - 1] ?? '';
  if (['>', '>>', '>|', '&>', '&>>'].includes(prev)) return true;
  if (WRITE_PROGRAMS.has(prog)) return true;
  return prog === 'sed' && argv.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place'));
}

export const DEFAULT_RULES: Rule[] = [
  {
    id: 'privilege',
    reason: '禁止提权命令（sudo、su、doas、pkexec）',
    match: ([p]) => ['sudo', 'su', 'doas', 'pkexec'].includes(base(p!)),
  },
  {
    id: 'rm-dangerous',
    reason: '禁止递归删除根目录、家目录、当前目录、上级目录或工作区目录本身',
    match: ([p, ...args], ctx) =>
      base(p!) === 'rm' && hasRecursive(args) && rmTargets(args).some((t) => isDangerousRmTarget(t, ctx.remoteRoot)),
  },
  {
    id: 'mkfs',
    reason: '禁止格式化文件系统',
    match: ([p]) => base(p!) === 'mkfs' || base(p!).startsWith('mkfs.'),
  },
  {
    id: 'dd-device',
    reason: '禁止用 dd 写入设备文件',
    match: ([p, ...args]) => base(p!) === 'dd' && args.some((a) => a.startsWith('of=/dev/') && a !== 'of=/dev/null'),
  },
  {
    id: 'power',
    reason: '禁止关机或重启服务器',
    match: ([p]) => ['shutdown', 'reboot', 'poweroff', 'halt'].includes(base(p!)),
  },
  {
    id: 'kill-all',
    reason: '禁止向所有进程发送信号（目标为 -1）',
    match: ([p, ...args]) => ['kill', 'pkill', 'killall'].includes(base(p!)) && args.at(-1) === '-1',
  },
  {
    id: 'chmod-777-recursive',
    reason: '禁止递归设置 777 权限',
    match: ([p, ...args]) => base(p!) === 'chmod' && hasRecursive(args) && args.includes('777'),
  },
  {
    id: 'authorized-keys',
    reason: '禁止写入、移动或删除 SSH 授权密钥文件 authorized_keys',
    match: (argv) => writesAuthorizedKeys(argv),
  },
  {
    id: 'fork-bomb',
    reason: '禁止 fork 炸弹',
    // 形如 name(){ name|name& };name：函数体内把自己管道给自己
    matchRaw: (command) => /([\w:]+)\(\)\{\1\|\1&?\}/.test(command.replace(/\s+/g, '')),
  },
  {
    id: 'crontab-remove',
    reason: '禁止删除全部定时任务（crontab -r）',
    match: ([p, ...args]) => base(p!) === 'crontab' && args.some((a) => isShortOpt(a) && a.includes('r')),
  },
];
