// 简易 shell 分词：只用于命令黑名单检查，目标是"尽力识别"，不是完整的 shell 解析器

/** 重定向符号，单独作为一个参数输出，便于规则判断写入目标 */
const REDIRECTS = ['>>', '>&', '>|', '>', '<<', '<'];

/**
 * 按未加引号的 `;`、`&&`、`||`、`|`、`&`、换行把命令拆成片段，每个片段是去掉引号后的参数列表。
 * 单引号内原样保留；双引号内反斜杠只转义 `"`、`\`、`$`、`` ` ``；引号外反斜杠转义下一个字符。
 */
export function splitSegments(command: string): string[][] {
  const segments: string[][] = [];
  let args: string[] = [];
  let token = '';
  let started = false; // 区分"空字符串参数"（如 ""）与"没有参数"

  const endToken = () => {
    if (started) args.push(token);
    token = '';
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (args.length > 0) segments.push(args);
    args = [];
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    const next = command[i + 1];

    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      token += command.slice(i + 1, stop);
      started = true;
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      started = true;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1]!)) {
          token += command[i + 1];
          i += 2;
        } else {
          token += command[i];
          i++;
        }
      }
      i++; // 跳过结尾的引号
      continue;
    }
    if (ch === '\\') {
      if (next === '\n') {
        i += 2; // 续行
        continue;
      }
      if (next !== undefined) token += next;
      started = true;
      i += 2;
      continue;
    }
    if (ch === '&' && next === '>') {
      endToken();
      const op = command[i + 2] === '>' ? '&>>' : '&>';
      args.push(op);
      i += op.length;
      continue;
    }
    const redirect = REDIRECTS.find((r) => command.startsWith(r, i));
    if (redirect) {
      endToken();
      args.push(redirect);
      i += redirect.length;
      continue;
    }
    if (ch === ';' || ch === '&' || ch === '|' || ch === '\n') {
      endSegment();
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endToken();
      i++;
      continue;
    }
    token += ch;
    started = true;
    i++;
  }
  endSegment();
  return segments;
}
