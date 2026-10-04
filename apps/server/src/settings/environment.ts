import type { EnvironmentReport, EnvironmentTool } from '@ssh-server/shared';
import { resolveCodexCommand } from '../agents/codex/launch';
import { runProcess, type ProcessRunner } from '../sync/process';
import { resolveClaudeExecutable } from '../agents/claude-launch';

type Command = { command: string; args: string[] };
type Probe = { name: EnvironmentTool['name']; command(): Command | Promise<Command>; args: string[]; version: RegExp };
const missing = (name: EnvironmentTool['name']): EnvironmentTool => ({
  name,
  available: false,
  version: null,
  message: '无法确认工具版本，请检查本机安装与启动路径；没有安装或修改软件。',
});
async function probe(tool: Probe, run: ProcessRunner, signal?: AbortSignal): Promise<EnvironmentTool> {
  try {
    const command = await tool.command();
    const result = await run(command.command, [...command.args, ...tool.args], {
      timeoutMs: 5000,
      outputCap: 2048,
      signal,
    });
    if (result.exitCode !== 0) return missing(tool.name);
    // 只提取版本号，不回传工具输出、私有路径或环境变量。
    const version = result.stdout.toString('utf8').match(tool.version)?.[1];
    return version ? { name: tool.name, available: true, version, message: null } : missing(tool.name);
  } catch {
    return missing(tool.name);
  }
}
export async function detectEnvironment(
  options: { run?: ProcessRunner; signal?: AbortSignal } = {},
): Promise<EnvironmentReport> {
  const probes: Probe[] = [
    {
      name: 'Claude Code',
      command: () => ({
        command: resolveClaudeExecutable(),
        args: [],
      }),
      args: ['--version'],
      version: /^(\d+\.\d+\.\d+)\s+\(Claude Code\)\s*$/m,
    },
    {
      name: 'Codex',
      command: () => resolveCodexCommand(),
      args: ['--version'],
      version: /^codex-cli (\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?)\s*$/m,
    },
    {
      name: 'git',
      command: () => ({ command: 'git', args: [] }),
      args: ['--version'],
      version: /^git version (\d+\.\d+\.\d+(?:\.[A-Za-z0-9.]+)?)\s*$/m,
    },
    {
      name: 'rclone',
      command: () => ({ command: process.env.SSH_SERVER_RCLONE ?? 'rclone', args: [] }),
      args: ['version'],
      version: /^rclone v(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?)\s*$/m,
    },
  ];
  const tools = await Promise.all(probes.map((tool) => probe(tool, options.run ?? runProcess, options.signal)));
  return {
    checkedAt: Date.now(),
    tools: [{ name: 'Node.js', available: true, version: process.versions.node, message: null }, ...tools],
  };
}
