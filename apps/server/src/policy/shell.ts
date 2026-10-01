// 简易 shell 分词：只用于命令黑名单检查，目标是"尽力识别"，不是完整的 shell 解析器

/** 重定向符号，单独作为一个参数输出，便于规则判断写入目标 */
const REDIRECTS = ['&>>', '&>', '>>', '>&', '>|', '>', '<<', '<'];
const SEPARATORS = new Set([';', '&', '|', '\n']);
const BLANKS = new Set([' ', '\t', '\r']);
/** 双引号内反斜杠只转义这几个字符 */
const DQ_ESCAPABLE = '"\\$`';

/** 逐字符扫描，累积当前参数与片段 */
class Tokenizer {
  readonly segments: string[][] = [];
  private args: string[] = [];
  private token = '';
  /** 区分"空字符串参数"（如 ""）与"没有参数" */
  private started = false;
  private i = 0;

  constructor(private readonly s: string) {}

  run(): string[][] {
    while (this.i < this.s.length) this.step();
    this.endSegment();
    return this.segments;
  }

  private step(): void {
    const ch = this.s[this.i]!;
    if (ch === "'") return this.singleQuoted();
    if (ch === '"') return this.doubleQuoted();
    if (ch === '\\') return this.escaped();
    const redirect = REDIRECTS.find((r) => this.s.startsWith(r, this.i));
    if (redirect) return this.operator(redirect);
    if (SEPARATORS.has(ch)) return this.separator();
    if (BLANKS.has(ch)) return this.blank();
    this.append(ch, 1);
  }

  private append(text: string, advance: number): void {
    this.token += text;
    this.started = true;
    this.i += advance;
  }

  /** 单引号内原样保留 */
  private singleQuoted(): void {
    const end = this.s.indexOf("'", this.i + 1);
    const stop = end === -1 ? this.s.length : end;
    this.append(this.s.slice(this.i + 1, stop), stop + 1 - this.i);
  }

  private doubleQuoted(): void {
    this.i++;
    this.started = true;
    while (this.i < this.s.length && this.s[this.i] !== '"') {
      const next = this.s[this.i + 1];
      const escapable = this.s[this.i] === '\\' && next !== undefined && DQ_ESCAPABLE.includes(next);
      this.append(escapable ? next : this.s[this.i]!, escapable ? 2 : 1);
    }
    this.i++; // 跳过结尾的引号
  }

  /** 引号外反斜杠转义下一个字符；反斜杠加换行是续行 */
  private escaped(): void {
    const next = this.s[this.i + 1];
    if (next === '\n') {
      this.i += 2;
      return;
    }
    this.append(next ?? '', 2);
  }

  private operator(op: string): void {
    this.endToken();
    this.args.push(op);
    this.i += op.length;
  }

  private separator(): void {
    this.endSegment();
    this.i++;
  }

  private blank(): void {
    this.endToken();
    this.i++;
  }

  private endToken(): void {
    if (this.started) this.args.push(this.token);
    this.token = '';
    this.started = false;
  }

  private endSegment(): void {
    this.endToken();
    if (this.args.length > 0) this.segments.push(this.args);
    this.args = [];
  }
}

/**
 * 按未加引号的 `;`、`&&`、`||`、`|`、`&`、换行把命令拆成片段，每个片段是去掉引号后的参数列表。
 * 单引号内原样保留；双引号内反斜杠只转义 `"`、`\`、`$`、`` ` ``；引号外反斜杠转义下一个字符。
 */
export function splitSegments(command: string): string[][] {
  return new Tokenizer(command).run();
}
