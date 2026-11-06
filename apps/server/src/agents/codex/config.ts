import { codexPermissionParams } from './permission-mode';
import type { AgentTurnInput } from '../contracts';
import { record, text, type RecordValue } from './types';

/** 未选择时完全沿用原生配置；显式权限按 Codex 原生预设映射。 */
export function threadParams(input: AgentTurnInput, nativeConfig: RecordValue): RecordValue {
  const config: RecordValue = {};
  // compact 没有 turn/start 的 effort 参数，显式选择也需传给线程配置；默认仍不覆盖。
  if (input.reasoningEffort) config.model_reasoning_effort = input.reasoningEffort;
  const instructions = text(record(nativeConfig.config).developer_instructions);
  return {
    cwd: input.workspace.dir,
    ...codexPermissionParams(input.permission),
    config,
    ...(instructions ? { developerInstructions: instructions } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
}
