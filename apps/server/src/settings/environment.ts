import type { EnvironmentReport, EnvironmentTool } from '@ssh-server/shared';
import { resolveCodexCommand } from '../agents/codex/launch';
import { runProcess, type ProcessRunner } from '../sync/process';
import { resolveClaudeExecutable } from '../agents/claude-launch';
import { ProductSettingsError } from './product-settings';

type Command = { command: string; args: string[] };
type Probe = { name: EnvironmentTool['name']; command(): Command | Promise<Command>; args: string[]; version: RegExp };
const missing = (name: EnvironmentTool['name']): EnvironmentTool => ({
  name,
  available: false,
  version: null,
  message: '程序缺失或无法执行，请检查安装与启动路径；没有安装或修改软件。',
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
    return { name: tool.name, available: true, version: version ?? null, message: null };
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

export type EnvironmentService = {
  read(): Promise<EnvironmentReport>;
  refresh(signal?: AbortSignal): Promise<EnvironmentReport>;
};

/** 启动与网页共享一个报告；并发读取复用检测，手动刷新不能重复启动进程。 */
export function createEnvironmentService(detect: typeof detectEnvironment = detectEnvironment): EnvironmentService {
  let report: EnvironmentReport | undefined;
  let pending: Promise<EnvironmentReport> | undefined;
  const start = (signal?: AbortSignal) => {
    pending = detect({ signal })
      .then((value) => {
        signal?.throwIfAborted();
        report = value;
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    read: () => pending ?? (report ? Promise.resolve(report) : start()),
    refresh: async (signal) => {
      if (pending) throw new ProductSettingsError('invalid_request', 409, '环境检测正在进行，请等待完成');
      return start(signal);
    },
  };
}
