// 远程工具 MCP 服务：工具调用转发到后端内部接口，由后端统一做黑名单、SSH 与日志
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ExecResult } from '../ssh/exec';

type Denied = { ruleId: string; reason: string };
type BackendReply = ExecResult | { denied: Denied } | { error: string };
type ToolText = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function formatExecResult(r: ExecResult): string {
  const lines = [`退出码：${r.exitCode ?? '无'}（耗时 ${r.durationMs} ms）`];
  if (r.timedOut) lines.push('注意：命令已超时，已被终止。长时间任务请用 nohup 或 Slurm 提交。');
  if (r.truncated) lines.push('注意：输出过长，已截断，只保留末尾部分。');
  lines.push('--- stdout ---', r.stdout || '（空）');
  if (r.stderr) lines.push('--- stderr ---', r.stderr);
  return lines.join('\n');
}

export function formatDenied(d: Denied): string {
  return `命令被拒绝：${d.reason}（规则 ${d.ruleId}）`;
}

function toToolResult(reply: BackendReply): ToolText {
  if ('denied' in reply) return { content: [{ type: 'text', text: formatDenied(reply.denied) }], isError: true };
  if ('error' in reply) return { content: [{ type: 'text', text: `执行失败：${reply.error}` }], isError: true };
  return { content: [{ type: 'text', text: formatExecResult(reply) }], isError: reply.exitCode !== 0 };
}

export type RemoteToolsOptions = { internalUrl: string; token: string; fetch?: typeof fetch };

export function createRemoteToolsServer(opts: RemoteToolsOptions): McpServer {
  const doFetch = opts.fetch ?? fetch;

  async function call(path: string, body: unknown): Promise<ToolText> {
    try {
      const res = await doFetch(`${opts.internalUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as BackendReply & { message?: string };
      if (!res.ok)
        return { content: [{ type: 'text', text: `后端返回 ${res.status}：${data.message ?? ''}` }], isError: true };
      return toToolResult(data);
    } catch (e) {
      return { content: [{ type: 'text', text: `无法连接本地后端：${(e as Error).message}` }], isError: true };
    }
  }

  const server = new McpServer({ name: 'ssh-server', version: '0.1.0' });

  server.registerTool(
    'remote_exec',
    {
      description:
        '在 SSH 服务器的工作区目录下执行命令（登录 shell，会加载 conda 等环境）。用于运行、训练、测试、查看数据。' +
        '默认超时 600 秒，最长 3600 秒；长时间任务请用 nohup 或 Slurm 提交后再查看进度。危险命令会被黑名单拒绝。',
      inputSchema: {
        command: z.string().min(1).describe('要执行的 shell 命令'),
        timeoutSec: z.number().int().min(1).max(3600).optional().describe('超时秒数'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ command, timeoutSec }) => call('/internal/remote-exec', { command, timeoutSec }),
  );

  server.registerTool(
    'remote_peek',
    {
      description:
        '只读查看服务器上的文件或目录（适合未同步到本地的大文件）：stat 看类型与大小，head / tail 看开头或末尾若干行，du 看目录占用。' +
        '路径可相对工作区目录，也可以是绝对路径。',
      inputSchema: {
        path: z.string().min(1).describe('文件或目录路径'),
        action: z.enum(['stat', 'head', 'tail', 'du']).describe('查看方式'),
        lines: z.number().int().min(1).max(200).optional().describe('head / tail 的行数，默认 50'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path, action, lines }) => call('/internal/remote-peek', { path, action, lines }),
  );

  return server;
}
