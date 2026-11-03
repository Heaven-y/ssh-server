import type { AgentTurnInput } from '../types';
import { buildInstructions } from '../instructions';
import { record, text, type RecordValue } from './types';

/** 覆盖只包含本产品的工作区约束；模型和服务商默认由原生配置决定。 */
export function threadParams(input: AgentTurnInput, nativeConfig: RecordValue): RecordValue {
  const config: RecordValue = {};
  // compact 没有 turn/start 的 effort 参数，显式选择也需传给线程配置；默认仍不覆盖。
  if (input.reasoningEffort) config.model_reasoning_effort = input.reasoningEffort;
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
