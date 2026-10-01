// 远程命令黑名单：在执行前检查 Agent 发来的命令
import { DEFAULT_RULES, type PolicyContext, type Rule } from './default-rules';
import { splitSegments } from './shell';

export type { PolicyContext, Rule } from './default-rules';
export type PolicyDecision = { allowed: true } | { allowed: false; ruleId: string; reason: string };

/** 不改变真正执行程序的包装命令 */
const WRAPPERS = new Set([
  'nohup',
  'time',
  'nice',
  'env',
  'exec',
  'command',
  'builtin',
  'stdbuf',
  'ionice',
  'setsid',
  'timeout',
]);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** 会把参数当作命令执行的 shell */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
/** 嵌套检查的最大深度，防止异常输入导致无限递归 */
const MAX_DEPTH = 5;

const programName = (arg: string) => arg.slice(arg.lastIndexOf('/') + 1);

/** 这些选项后面还跟一个值，如 nice -n 10、timeout -s KILL */
function optionTakesValue(prog: string, opt: string): boolean {
  return (prog === 'nice' && opt === '-n') || (prog === 'timeout' && (opt === '-s' || opt === '-k'));
}

/** 从 i 开始跳过包装命令的选项（及其值），返回下一个位置 */
function skipWrapperOptions(argv: string[], i: number, prog: string): number {
  while (i < argv.length && (argv[i]!.startsWith('-') || ENV_ASSIGN.test(argv[i]!))) {
    const opt = argv[i]!;
    i += optionTakesValue(prog, opt) ? 2 : 1;
  }
  // timeout 的时长参数
  return prog === 'timeout' && i < argv.length ? i + 1 : i;
}

/** 去掉前置的 VAR=值 和包装命令（及其选项），返回真正执行的程序及参数 */
function unwrap(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (ENV_ASSIGN.test(a)) {
      i++;
      continue;
    }
    const prog = programName(a);
    if (!WRAPPERS.has(prog)) break;
    i = skipWrapperOptions(argv, i + 1, prog);
  }
  return argv.slice(i);
}

/** bash -c "..."、eval ... 中作为命令执行的字符串 */
function nestedCommands(argv: string[]): string[] {
  const prog = programName(argv[0]!);
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

const firstDenied = (decisions: Iterable<PolicyDecision>) => {
  for (const d of decisions) if (!d.allowed) return d;
  return undefined;
};

/** 检查一个片段：规则匹配，再递归检查 bash -c / eval 中的命令 */
function* checkSegment(segment: string[], ctx: PolicyContext, rules: Rule[], depth: number): Generator<PolicyDecision> {
  const argv = unwrap(segment);
  if (argv.length === 0) return;
  const rule = rules.find((r) => r.match?.(argv, ctx));
  if (rule) yield deny(rule);
  for (const nested of nestedCommands(argv)) yield check(nested, ctx, rules, depth + 1);
}

function* decisions(command: string, ctx: PolicyContext, rules: Rule[], depth: number): Generator<PolicyDecision> {
  const raw = rules.find((r) => r.matchRaw?.(command));
  if (raw) yield deny(raw);
  for (const segment of splitSegments(command)) yield* checkSegment(segment, ctx, rules, depth);
  for (const sub of substitutions(command)) yield check(sub, ctx, rules, depth + 1);
}

/** 生成器按顺序产出判断，遇到第一个拒绝就停止（与逐条检查、提前返回等价） */
function check(command: string, ctx: PolicyContext, rules: Rule[], depth: number): PolicyDecision {
  if (depth > MAX_DEPTH) return { allowed: true };
  return firstDenied(decisions(command, ctx, rules, depth)) ?? { allowed: true };
}

/** 检查一条命令是否命中黑名单 */
export function checkCommand(command: string, ctx: PolicyContext): PolicyDecision {
  const disabled = new Set(ctx.disabledRules ?? []);
  const rules = DEFAULT_RULES.filter((r) => !disabled.has(r.id));
  return check(command, ctx, rules, 0);
}
