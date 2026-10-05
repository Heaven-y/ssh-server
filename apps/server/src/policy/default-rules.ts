// 默认命令黑名单规则。只防误操作，不能防有意绕过（编码、写进脚本再执行等）。
import { DEFAULT_POLICY_RULE_REASONS, type CustomPolicyRule } from '@ssh-server/shared';

export type PolicyContext = {
  /** 工作区服务器目录，如 ~/projects/demo */
  remoteRoot: string;
  /** 工作区停用的规则 id */
  disabledRules?: string[];
  customRules?: CustomPolicyRule[];
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
    reason: DEFAULT_POLICY_RULE_REASONS.privilege,
    match: ([p]) => ['sudo', 'su', 'doas', 'pkexec'].includes(base(p!)),
  },
  {
    id: 'rm-dangerous',
    reason: DEFAULT_POLICY_RULE_REASONS['rm-dangerous'],
    match: ([p, ...args], ctx) =>
      base(p!) === 'rm' && hasRecursive(args) && rmTargets(args).some((t) => isDangerousRmTarget(t, ctx.remoteRoot)),
  },
  {
    id: 'mkfs',
    reason: DEFAULT_POLICY_RULE_REASONS.mkfs,
    match: ([p]) => base(p!) === 'mkfs' || base(p!).startsWith('mkfs.'),
  },
  {
    id: 'dd-device',
    reason: DEFAULT_POLICY_RULE_REASONS['dd-device'],
    match: ([p, ...args]) => base(p!) === 'dd' && args.some((a) => a.startsWith('of=/dev/') && a !== 'of=/dev/null'),
  },
  {
    id: 'power',
    reason: DEFAULT_POLICY_RULE_REASONS.power,
    match: ([p]) => ['shutdown', 'reboot', 'poweroff', 'halt'].includes(base(p!)),
  },
  {
    id: 'kill-all',
    reason: DEFAULT_POLICY_RULE_REASONS['kill-all'],
    match: ([p, ...args]) => ['kill', 'pkill', 'killall'].includes(base(p!)) && args.at(-1) === '-1',
  },
  {
    id: 'chmod-777-recursive',
    reason: DEFAULT_POLICY_RULE_REASONS['chmod-777-recursive'],
    match: ([p, ...args]) => base(p!) === 'chmod' && hasRecursive(args) && args.includes('777'),
  },
  {
    id: 'authorized-keys',
    reason: DEFAULT_POLICY_RULE_REASONS['authorized-keys'],
    match: (argv) => writesAuthorizedKeys(argv),
  },
  {
    id: 'fork-bomb',
    reason: DEFAULT_POLICY_RULE_REASONS['fork-bomb'],
    // 形如 name(){ name|name& };name：函数体内把自己管道给自己
    matchRaw: (command) => /([\w:]+)\(\)\{\1\|\1&?\}/.test(command.replace(/\s+/g, '')),
  },
  {
    id: 'crontab-remove',
    reason: DEFAULT_POLICY_RULE_REASONS['crontab-remove'],
    match: ([p, ...args]) => base(p!) === 'crontab' && args.some((a) => isShortOpt(a) && a.includes('r')),
  },
];
