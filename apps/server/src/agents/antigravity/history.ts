import type { AgentEvent } from '@agentdeck/shared/conversation';
import { managementObject as object, managementText as text, type ManagementRecord } from './management-rpc';
import { contextEvent, historyTiming, stepUsage } from './metrics';

const DONE = 'CORTEX_STEP_STATUS_DONE';
const FAILED = new Set(['CORTEX_STEP_STATUS_ERROR', 'CORTEX_STEP_STATUS_INVALID']);
const TOOL_TYPES = new Set([
  'CORTEX_STEP_TYPE_RUN_COMMAND',
  'CORTEX_STEP_TYPE_VIEW_FILE',
  'CORTEX_STEP_TYPE_FILE_CHANGE',
  'CORTEX_STEP_TYPE_WRITE_TO_FILE',
  'CORTEX_STEP_TYPE_MCP_TOOL',
  'CORTEX_STEP_TYPE_GENERIC',
]);
const clip = (value: string) => (value.length > 20_000 ? `${value.slice(0, 20_000)}\n[输出已截断]` : value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function argumentsOf(value: unknown): unknown {
  const json = text(object(value).argumentsJson);
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return clip(json);
  }
}

function command(step: ManagementRecord) {
  const value = object(step.runCommand);
  const output = object(value.combinedOutput);
  const snapshot = object(value.combinedOutputSnapshot);
  return {
    name: 'run_command',
    input: { command: value.commandLine ?? value.command, cwd: value.cwd },
    output:
      text(output.full) ||
      text(output.truncated) ||
      text(snapshot.full) ||
      text(snapshot.truncated) ||
      [text(value.stdout), text(value.stderr)].filter(Boolean).join('\n'),
    failed:
      value.userRejected === true ||
      value.timedOut === true ||
      (typeof value.exitCode === 'number' && value.exitCode !== 0),
  };
}

function file(step: ManagementRecord) {
  const read = object(step.viewFile);
  if (step.type === 'CORTEX_STEP_TYPE_VIEW_FILE')
    return {
      name: 'read_file',
      input: { path: read.absolutePathUri, startLine: read.startLine, endLine: read.endLine },
      output: text(read.content),
    };
  const change = object(step.fileChange);
  const write = object(step.writeToFile);
  return {
    name: 'fileChange',
    input: {
      ...object(argumentsOf(object(step.metadata).toolCall)),
      path: change.absolutePathUri ?? write.targetFileUri,
    },
    output: text(write.codeContent) || text(change.instruction),
  };
}

function tool(step: ManagementRecord) {
  const call = object(object(step.metadata).toolCall);
  if (step.type === 'CORTEX_STEP_TYPE_RUN_COMMAND') return command(step);
  if (
    ['CORTEX_STEP_TYPE_VIEW_FILE', 'CORTEX_STEP_TYPE_FILE_CHANGE', 'CORTEX_STEP_TYPE_WRITE_TO_FILE'].includes(
      text(step.type),
    )
  )
    return file(step);
  if (step.type === 'CORTEX_STEP_TYPE_MCP_TOOL') {
    const mcp = object(step.mcpTool);
    return {
      name: `mcp__${text(mcp.serverName)}__${text(object(mcp.toolCall).name)}`,
      input: argumentsOf(mcp.toolCall),
      output: text(mcp.resultString),
      failed: mcp.userRejected === true,
    };
  }
  if (step.type === 'CORTEX_STEP_TYPE_GENERIC') {
    const generic = object(step.generic);
    return {
      name: text(call.name) || '原生工具',
      input: generic.args ?? argumentsOf(call),
      output: text(object(generic.result).result),
    };
  }
  // 未适配的步骤只展示原生类型、工具参数与状态，绝不展开内部 Any、签名和调试正文。
  return {
    name: text(call.name) || text(step.type).replace('CORTEX_STEP_TYPE_', ''),
    input: { arguments: argumentsOf(call), status: step.status },
    output: '',
  };
}

function toolEvents(step: ManagementRecord, index: number): AgentEvent[] {
  const value = tool(step);
  const id = `agy-step-${index}`;
  const events: AgentEvent[] = [{ type: 'tool_call', id, name: value.name, input: value.input }];
  if (step.status !== DONE && !FAILED.has(text(step.status))) return events;
  events.push({
    type: 'tool_result',
    id,
    output: clip(value.output || text(object(step.error).userErrorMessage)),
    isError: FAILED.has(text(step.status)) || ('failed' in value && value.failed === true),
    ...historyTiming(step.metadata),
  });
  return events;
}

function checkpoint(step: ManagementRecord): AgentEvent[] {
  const failed = object(step.checkpoint).modelSummarizationFailed === true || FAILED.has(text(step.status));
  const status = failed ? 'failed' : step.status === DONE ? 'completed' : 'cancelled';
  return [{ type: 'compaction', state: { status } }];
}

function activityStatus(status: unknown): Extract<AgentEvent, { type: 'activity' }>['status'] {
  if (status === DONE) return 'completed';
  if (FAILED.has(text(status))) return 'failed';
  if (['CORTEX_STEP_STATUS_CANCELED', 'CORTEX_STEP_STATUS_INTERRUPTED'].includes(text(status))) return 'cancelled';
  if (
    [
      'CORTEX_STEP_STATUS_RUNNING',
      'CORTEX_STEP_STATUS_GENERATING',
      'CORTEX_STEP_STATUS_PENDING',
      'CORTEX_STEP_STATUS_QUEUED',
      'CORTEX_STEP_STATUS_WAITING',
    ].includes(text(status))
  )
    return 'running';
  return 'unknown';
}

function activity(step: ManagementRecord, index: number): AgentEvent[] {
  const type = text(step.type);
  if (!type) return [];
  return [
    {
      type: 'activity',
      id: `agy-step-${index}`,
      name: type.replace('CORTEX_STEP_TYPE_', ''),
      status: activityStatus(step.status),
      input: { type, status: step.status },
      ...historyTiming(step.metadata),
    },
  ];
}

function response(step: ManagementRecord, index: number): AgentEvent[] {
  const planner = object(step.plannerResponse);
  const content = text(planner.modifiedResponse) || text(planner.response);
  const events: AgentEvent[] = content ? [{ type: 'text', delta: content }] : [];
  const usage = stepUsage(object(step.metadata).modelUsage);
  if (step.status === DONE && usage)
    // 模型用量不与执行起止时间混算速度；生成计时的范围须由原生字段进一步证明。
    events.push({ type: 'step_usage', id: `agy-step-${index}`, usage });
  return events;
}

function toolOrActivity(step: ManagementRecord, index: number): AgentEvent[] {
  return TOOL_TYPES.has(text(step.type)) || text(object(object(step.metadata).toolCall).name)
    ? toolEvents(step, index)
    : activity(step, index);
}

function errorMessage(step: ManagementRecord): string {
  const error = object(step.errorMessage);
  return error.shouldShowUser === true ? text(object(error.error).userErrorMessage) : '';
}

function stepEvents(step: ManagementRecord, index: number): AgentEvent[] {
  switch (step.type) {
    case 'CORTEX_STEP_TYPE_USER_INPUT': {
      const user = object(step.userInput);
      const content =
        text(user.query) ||
        list(user.items)
          .map((item) => text(object(item).text))
          .filter(Boolean)
          .join('\n');
      return content ? [{ type: 'user_message', text: content }] : [];
    }
    case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE':
      return response(step, index);
    case 'CORTEX_STEP_TYPE_CHECKPOINT':
      return checkpoint(step);
    case 'CORTEX_STEP_TYPE_ERROR_MESSAGE': {
      const message = errorMessage(step);
      return message ? [{ type: 'error', message: clip(message) }] : [];
    }
    default:
      return toolOrActivity(step, index);
  }
}

/** 轮次边界来自原生用户输入；工具调用后的助手片段不能冒充整轮结束。 */
export function antigravityHistory(trajectory: ManagementRecord): AgentEvent[] {
  const events: AgentEvent[] = [];
  let forkPoint: string | undefined;
  let failed = false;
  let started = false;
  list(trajectory.steps).forEach((value, index) => {
    const step = object(value);
    if (step.type === 'CORTEX_STEP_TYPE_USER_INPUT' && started) {
      events.push({ type: 'turn_end', isError: failed, ...(forkPoint ? { forkPoint } : {}) });
      forkPoint = undefined;
      failed = false;
    }
    started = true;
    if (step.status === DONE && step.type !== 'CORTEX_STEP_TYPE_USER_INPUT') forkPoint = String(index);
    else forkPoint = undefined;
    failed ||= FAILED.has(text(step.status)) || !!errorMessage(step);
    events.push(...stepEvents(step, index));
  });
  if (started) events.push({ type: 'turn_end', isError: failed, ...(forkPoint ? { forkPoint } : {}) });
  const last = object(list(trajectory.generatorMetadata).at(-1));
  const context = object(object(last.chatModel).chatStartMetadata).contextWindowMetadata;
  events.push(...contextEvent(context));
  return events;
}
