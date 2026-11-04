import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { resolveLocalCommand } from '../process/executable';

/** 与本机探测共用入口；脚本用解析到的 Node 启动，不让 SDK 另选运行时或包内程序。 */
export function resolveClaudeLaunch(
  env: NodeJS.ProcessEnv = process.env,
): Pick<Options, 'pathToClaudeCodeExecutable' | 'executableArgs'> {
  const resolved = resolveLocalCommand('claude', env);
  return { pathToClaudeCodeExecutable: resolved.command, executableArgs: resolved.args };
}
