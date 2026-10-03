import type { AgentTurnInput } from '../types';
import { buildInstructions } from '../instructions';
import { MCP_SERVER_NAME, resolveRemoteToolsCommand } from '../../remote-tools/launch';
import { record, text, type RecordValue } from './types';

/** 覆盖只包含本产品的 MCP 与工作区约束；模型和服务商默认由原生配置决定。 */
export function threadParams(input: AgentTurnInput, nativeConfig: RecordValue): RecordValue {
  const remote = resolveRemoteToolsCommand();
  const envNames = Object.keys(input.mcpEnv);
  const config: RecordValue = {
    [`mcp_servers.${MCP_SERVER_NAME}`]: {
      command: remote.command,
      args: remote.args,
      env_vars: envNames,
      enabled: true,
      required: true,
    },
  };
  // compact 没有 turn/start 的 effort 参数，显式选择也需传给线程配置；默认仍不覆盖。
  if (input.reasoningEffort) config.model_reasoning_effort = input.reasoningEffort;
  for (const key of envNames) {
    config[`shell_environment_policy.filters.${key}`] = 'exclude';
    config[`shell_environment_policy.set.${key}`] = '';
  }
  const instructions = text(record(nativeConfig.config).developer_instructions);
  return {
    cwd: input.workspace.localDir,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    config,
    developerInstructions: [instructions, buildInstructions(input.workspace)].filter(Boolean).join('\n\n'),
    ...(input.model ? { model: input.model } : {}),
  };
}
