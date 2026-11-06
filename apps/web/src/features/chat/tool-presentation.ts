/** 原生工具名可能包含 MCP 服务器前缀，标题保留最后一段。 */
export const shortToolName = (name: string) => name.split('__').at(-1) ?? name;

const argumentKeys = [
  'command',
  'CommandLine',
  'file_path',
  'TargetFile',
  'AbsolutePath',
  'path',
  'pattern',
  'query',
  'url',
];

export function toolPrimaryArgument(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return;
  const values = input as Record<string, unknown>;
  const argument = argumentKeys.map((key) => values[key]).find((value) => typeof value === 'string');
  if (typeof argument === 'string') return argument;
  if (!Array.isArray(values.changes)) return;
  return values.changes
    .flatMap((change: unknown) => {
      if (!change || typeof change !== 'object' || !('path' in change) || typeof change.path !== 'string') return [];
      return [change.path];
    })
    .join(', ');
}
