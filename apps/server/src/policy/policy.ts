// 远程命令黑名单：在执行前检查 Agent 发来的命令
import { DEFAULT_RULES, type PolicyContext, type Rule } from './default-rules';
import { splitSegments } from './shell';

export type { PolicyContext, Rule } from './default-rules';
export type PolicyDecision = { allowed: true } | { allowed: false; ruleId: string; reason: string };

/** 不改变真正执行程序的包装命令 */
const WRAPPERS = new Set(['nohup', 'time', 'nice', 'env', 'exec', 'command', 'builtin', 'stdbuf', 'ionice', 'setsid', 'timeout']);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** 会把参数当作命令执行的 shell */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
/** 嵌套检查的最大深度，防止异常输入导致无限递归 */
const MAX_DEPTH = 5;

/** 去掉前置的 VAR=值 和包装命令（及其选项），返回真正执行的程序及参数 */
function unwrap(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (ENV_ASSIGN.test(a)) {
      i++;
      continue;
    }
    const prog = a.slice(a.lastIndexOf('/') + 1);
    if (!WRAPPERS.has(prog)) break;
    i++;
    // 跳过包装命令的选项，以及 nice -n 10、timeout 30 这类带值的参数
    while (i < argv.length && (argv[i]!.startsWith('-') || ENV_ASSIGN.test(argv[i]!))) {
      const opt = argv[i]!;
      i++;
      if ((prog === 'nice' && opt === '-n') || (prog === 'timeout' && (opt === '-s' || opt === '-k'))) i++;
    }
    if (prog === 'timeout' && i < argv.length) i++; // timeout 的时长参数
  }
  return argv.slice(i);
}

/** bash -c "..."、eval ... 中作为命令执行的字符串 */
function nestedCommands(argv: string[]): string[] {
  const prog = argv[0]!.slice(argv[0]!.lastIndexOf('/') + 1);
  if (SHELLS.has(prog)) {
    const idx = argv.findIndex((a, i) => i > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    const cmd = idx === -1 ? undefined : argv[idx + 1];
    return cmd === undefined ? [] : [cmd];
  }
  if (prog === 'eval') return argv.length > 1 ? [argv.slice(1).join(' ')] : [];
  return [];
}

/** $(...) 与 `...` 中的命令（不处理嵌套括号，尽力识别） */
function substitutions(command: string): string[] {
  return [...command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? '').filter(Boolean);
}

function deny(rule: Rule): PolicyDecision {
  return { allowed: false, ruleId: rule.id, reason: rule.reason };
}

function check(command: string, ctx: PolicyContext, rules: Rule[], depth: number): PolicyDecision {
  if (depth > MAX_DEPTH) return { allowed: true };

  for (const rule of rules) {
    if (rule.matchRaw?.(command)) return deny(rule);
  }

  for (const segment of splitSegments(command)) {
    const argv = unwrap(segment);
    if (argv.length === 0) continue;
    for (const rule of rules) {
      if (rule.match?.(argv, ctx)) return deny(rule);
    }
    for (const nested of nestedCommands(argv)) {
      const r = check(nested, ctx, rules, depth + 1);
      if (!r.allowed) return r;
    }
  }

  for (const sub of substitutions(command)) {
    const r = check(sub, ctx, rules, depth + 1);
    if (!r.allowed) return r;
  }
  return { allowed: true };
}

/** 检查一条命令是否命中黑名单 */
export function checkCommand(command: string, ctx: PolicyContext): PolicyDecision {
  const disabled = new Set(ctx.disabledRules ?? []);
  const rules = DEFAULT_RULES.filter((r) => !disabled.has(r.id));
  return check(command, ctx, rules, 0);
}
