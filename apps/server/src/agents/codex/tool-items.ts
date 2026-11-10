import { list, record, text, type RecordValue } from './types';
import { nonnegativeInteger } from './observability';

type ToolDescription = { name: string; input: unknown };
const TOOL_INPUTS: Record<string, (item: RecordValue) => ToolDescription> = {
  commandExecution: (item) => ({ name: 'commandExecution', input: { command: item.command, cwd: item.cwd } }),
  fileChange: (item) => ({ name: 'fileChange', input: { changes: item.changes } }),
  mcpToolCall: (item) => ({ name: `mcp__${text(item.server)}__${text(item.tool)}`, input: item.arguments }),
  dynamicToolCall: (item) => ({ name: `dynamic__${text(item.tool)}`, input: item.arguments }),
  webSearch: (item) => ({ name: 'webSearch', input: { query: item.query, action: item.action } }),
  collabAgentToolCall: (item) => ({
    name: `collab__${text(item.tool)}`,
    input: { prompt: item.prompt, model: item.model, receiverThreadIds: item.receiverThreadIds },
  }),
  plan: () => ({ name: 'plan', input: {} }),
  subAgentActivity: (item) => ({
    name: 'subAgentActivity',
    input: { kind: item.kind, agentPath: item.agentPath, agentThreadId: item.agentThreadId },
  }),
  imageView: (item) => ({ name: 'imageView', input: { path: item.path } }),
};

export const isCodexTool = (item: RecordValue): boolean => Object.hasOwn(TOOL_INPUTS, text(item.type));
export const codexToolInput = (item: RecordValue): ToolDescription => TOOL_INPUTS[text(item.type)]!(item);
const STATEFUL_TOOLS = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
]);
const FINISHED_STATUSES = new Set(['completed', 'failed', 'declined', 'cancelled', 'interrupted']);

/** 带状态的工具必须明确终止；无状态旧记录不能只凭所在轮次结束就认定成功。 */
export function codexToolCompleted(item: RecordValue, completionConfirmed: boolean): boolean {
  if (STATEFUL_TOOLS.has(text(item.type))) return FINISHED_STATUSES.has(text(item.status));
  return completionConfirmed || nonnegativeInteger(item.completedAtMs) !== undefined;
}

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

function fileDiff(item: RecordValue): string {
  return list(item.changes)
    .map((change) => {
      const value = record(change);
      return `${text(value.path)}\n${text(value.diff)}`;
    })
    .join('\n');
}

function dynamicOutput(item: RecordValue): string {
  return list(item.contentItems)
    .map((part) => {
      const value = record(part);
      if (value.type === 'inputText') return text(value.text);
      if (value.type === 'inputImage') return '[图片]';
      return value.type === 'inputAudio' ? '[音频]' : '';
    })
    .join('\n');
}

const TOOL_OUTPUTS: Record<string, (item: RecordValue) => string> = {
  commandExecution: (item) => text(item.aggregatedOutput),
  fileChange: fileDiff,
  mcpToolCall: (item) => printable(item.error ?? item.result),
  dynamicToolCall: dynamicOutput,
  webSearch: (item) => printable(item.results ?? item.action),
  collabAgentToolCall: (item) => printable(item.agentsStates),
  plan: (item) => text(item.text),
  subAgentActivity: (item) => text(item.kind),
  imageView: (item) => text(item.path),
};

export function codexToolOutput(item: RecordValue, preserveToolContent = false): string {
  const output = TOOL_OUTPUTS[text(item.type)]!(item);
  return preserveToolContent || output.length <= 20_000
    ? output
    : `${output.slice(0, 20_000)}\n[已截断，共 ${output.length} 字符]`;
}

export function codexToolFailed(item: RecordValue): boolean {
  return (
    ['failed', 'declined', 'cancelled', 'interrupted'].includes(text(item.status)) ||
    item.success === false ||
    (typeof item.exitCode === 'number' && item.exitCode !== 0)
  );
}
