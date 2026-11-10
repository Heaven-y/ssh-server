import type { IBuffer, IBufferLine, IBufferRange } from '@xterm/xterm';
export type TerminalSearchResults = { index: number; total: number };

function lineText(line: IBufferLine, next?: IBufferLine) {
  const wrapped = next?.isWrapped === true;
  let text = line.translateToString(!wrapped);
  const last = line.getCell(line.length - 1);
  // 宽字符在下一行开头时，上一行最后的空占位不属于实际文本。
  if (wrapped && last?.getCode() === 0 && last.getWidth() === 1 && next?.getCell(0)?.getWidth() === 2)
    text = text.slice(0, -1);
  return text;
}
function countLine(text: string, query: string, selected: number, results: TerminalSearchResults) {
  const lower = text.toLowerCase();
  const offset = selected < 0 ? -1 : text.slice(0, selected).toLowerCase().length;
  let start = 0;
  while (start <= lower.length - query.length) {
    const match = lower.indexOf(query, start);
    if (match < 0) break;
    results.total++;
    if (match === offset) results.index = results.total;
    start = match + 1;
  }
}
/** addon 的统计只包含前 1000 个装饰；数量和序号直接按实际回滚缓冲计算。 */
export function countTerminalMatches(buffer: IBuffer, query: string, selection?: IBufferRange): TerminalSearchResults {
  const results = { index: 0, total: 0 };
  if (!query) return results;
  const needle = query.toLowerCase();
  let text = '';
  let selected = -1;
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    if (!line.isWrapped) {
      countLine(text, needle, selected, results);
      text = '';
      selected = -1;
    }
    if (selection?.start.y === row) selected = text.length + line.translateToString(false, 0, selection.start.x).length;
    text += lineText(line, buffer.getLine(row + 1));
  }
  countLine(text, needle, selected, results);
  return results;
}

export function terminalSearchDecorations(dark: boolean) {
  const border = dark ? '#eabb55' : '#a56600';
  return {
    matchBackground: dark ? '#594511' : '#fff0b3',
    activeMatchBackground: dark ? '#81601a' : '#ffd164',
    activeMatchBorder: border,
    matchOverviewRuler: border,
    activeMatchColorOverviewRuler: border,
  };
}
