import type { AgentTurnInput } from '../types';
import { record, text, type RecordValue } from './types';

/**
 * 模型、服务商、审批、沙箱与行为指令默认由原生配置决定。
 *
 * `sandbox` 与 `approvalPolicy` 曾在这里写死为 workspace-write / on-request，那等于用网页常量
 * 覆盖用户在 `~/.codex/config.toml` 里的选择。按设计 §6.1「审批面由 CLI 自己的原生配置决定，
 * 网页不加自己的规则」，这两项已移除。
 *
 * `approvalsReviewer: 'user'` 是例外并保留：它不决定「要不要问」，只决定「问谁」——把原生
 * 决定要问的审批路由给网页用户，而不是交给某个自动审阅者。
 */
export function threadParams(input: AgentTurnInput, nativeConfig: RecordValue): RecordValue {
  const config: RecordValue = {};
  // compact 没有 turn/start 的 effort 参数，显式选择也需传给线程配置；默认仍不覆盖。
  if (input.reasoningEffort) config.model_reasoning_effort = input.reasoningEffort;
  const instructions = text(record(nativeConfig.config).developer_instructions);
  return {
    cwd: input.workspace.dir,
    approvalsReviewer: 'user',
    config,
    ...(instructions ? { developerInstructions: instructions } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
}
