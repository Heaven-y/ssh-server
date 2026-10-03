import type { AgentCapability } from '@ssh-server/shared';

/** 只补全消息开头的命令名；路径、正文和已经进入参数区的光标保持普通编辑。 */
export function slashCompletion(text: string, start: number, end = start) {
  if (start !== end) return undefined;
  const match = /^\s*\/([^\s/]*)(?=\s|$)/.exec(text);
  if (!match) return undefined;
  const tokenEnd = match[0].length;
  const tokenStart = tokenEnd - match[1]!.length;
  if (start < tokenStart || start > tokenEnd) return undefined;
  return { query: match[1]!, remainder: text.slice(tokenEnd).trimStart() };
}

export function matchesCapability(entry: AgentCapability, search: string): boolean {
  const phrase = search.trim().toLocaleLowerCase();
  return [entry.name, entry.description, entry.source, ...(entry.aliases ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
    .includes(phrase);
}
