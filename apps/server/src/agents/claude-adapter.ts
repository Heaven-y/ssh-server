// Claude 适配器：用 Claude Agent SDK 驱动本机 Claude Code，跑一轮对话并输出统一事件
import { randomUUID } from 'node:crypto';
import { query as sdkQuery, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentTurnInput, PermissionAnswer, TurnHandle } from './types';
import { MCP_SERVER_NAME, resolveRemoteToolsCommand } from '../remote-tools/launch';
import { ClaudeEventMapper } from './claude-mapper';
import { isInsideDir } from './edit-scope';
import { buildInstructions } from './instructions';

/** SDK query 中用到的部分，便于测试注入 */
export type QueryFn = (params: {
  prompt: string;
  options: Options;
}) => AsyncIterable<unknown> & { interrupt(): Promise<unknown> };

export type ClaudeTurnInput = AgentTurnInput & { queryFn?: QueryFn };
export type { PermissionAnswer, TurnHandle } from './types';

export const PERMISSION_TIMEOUT_MS = 300_000;
const ABORT_FALLBACK_MS = 5_000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const ALLOWED_TOOLS = [
  `mcp__${MCP_SERVER_NAME}__remote_exec`,
  `mcp__${MCP_SERVER_NAME}__remote_peek`,
  `mcp__${MCP_SERVER_NAME}__sync_now`,
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
];

/** Windows 上子进程缺少 PATH、SystemRoot 会起不来，所以在 process.env 基础上合并 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return { ...env, ...extra };
}

function editTarget(input: Record<string, unknown>): string | undefined {
  const p = input.file_path ?? input.notebook_path;
  return typeof p === 'string' ? p : undefined;
}

/** 等待网页答复；超时或被中断时拒绝 */
function waitAnswer(pending: Promise<PermissionAnswer>, signal: AbortSignal): Promise<PermissionAnswer> {
  if (signal.aborted) return Promise.resolve({ allow: false, message: '本轮已中断' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (a: PermissionAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(a);
    };
    const timer = setTimeout(() => finish({ allow: false, message: '等待确认超时，已拒绝' }), PERMISSION_TIMEOUT_MS);
    const onAbort = () => finish({ allow: false, message: '本轮已中断' });
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(finish, () => finish({ allow: false, message: '确认请求失败' }));
  });
}

export function runClaudeTurn(input: ClaudeTurnInput): TurnHandle {
  const { workspace } = input;
  const remoteTools = resolveRemoteToolsCommand();
  const abortController = new AbortController();

  const canUseTool = async (toolName: string, toolInput: Record<string, unknown>, opts: { signal: AbortSignal }) => {
    const target = editTarget(toolInput);
    if (EDIT_TOOLS.has(toolName) && target && isInsideDir(workspace.localDir, target)) {
      return { behavior: 'allow' as const, updatedInput: toolInput };
    }
    const requestId = randomUUID();
    input.emit({ type: 'permission_request', requestId, toolName, input: toolInput });
    const answer = await waitAnswer(input.requestPermission({ requestId, toolName, input: toolInput }), opts.signal);
    input.emit({ type: 'permission_resolved', requestId, decision: answer.allow ? 'allowed' : 'denied' });
    return answer.allow
      ? { behavior: 'allow' as const, updatedInput: toolInput }
      : { behavior: 'deny' as const, message: answer.message ?? '用户拒绝' };
  };

  const options = {
    cwd: workspace.localDir,
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: buildInstructions(workspace) },
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'stdio',
        command: remoteTools.command,
        args: remoteTools.args,
        env: childEnv(input.mcpEnv),
      },
    },
    allowedTools: ALLOWED_TOOLS,
    canUseTool,
    includePartialMessages: true,
    abortController,
    ...(input.sessionId ? { resume: input.sessionId } : {}),
    ...(input.model ? { model: input.model } : {}),
  } as unknown as Options;

  const queryFn = input.queryFn ?? (sdkQuery as QueryFn);
  const q = queryFn({ prompt: input.text, options });
  let finished = false;

  const done = (async () => {
    const mapper = new ClaudeEventMapper();
    let ended = false;
    try {
      for await (const msg of q) {
        for (const e of mapper.map(msg)) {
          if (e.type === 'turn_end') ended = true;
          input.emit(e);
        }
      }
    } catch (e) {
      if (!abortController.signal.aborted) input.emit({ type: 'error', message: (e as Error).message });
    }
    if (!ended) input.emit({ type: 'turn_end', isError: true });
    finished = true;
  })();

  return {
    done,
    async interrupt() {
      try {
        await q.interrupt();
      } catch {
        abortController.abort();
        return;
      }
      // interrupt 后仍未结束时，再强制中止
      setTimeout(() => {
        if (!finished) abortController.abort();
      }, ABORT_FALLBACK_MS).unref?.();
    },
  };
}
