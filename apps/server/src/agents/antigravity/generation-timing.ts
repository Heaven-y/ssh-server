import type { GenerationTiming, TokenUsage } from '@agentdeck/shared/conversation';
import { managementObject as object, type ManagementRecord } from './management-rpc';
import { stepUsage } from './metrics';

function milliseconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(value)) return;
  const result = Number(value.slice(0, -1)) * 1000;
  return Number.isFinite(result) && result <= Number.MAX_SAFE_INTEGER ? result : undefined;
}

const sameUsage = (value: unknown, expected: TokenUsage) =>
  JSON.stringify(stepUsage(value)) === JSON.stringify(expected);

function matchedModel(
  trajectory: ManagementRecord,
  step: ManagementRecord,
  index: number,
): ManagementRecord | undefined {
  const metadata = object(step.metadata);
  const source = object(metadata.sourceTrajectoryStepInfo);
  const entries = Array.isArray(trajectory.generatorMetadata) ? trajectory.generatorMetadata : [];
  if (
    !Number.isSafeInteger(source.metadataIndex) ||
    source.stepIndex !== index ||
    source.cascadeId !== trajectory.cascadeId
  )
    return;
  const generator = object(entries[Number(source.metadataIndex)]);
  if (!metadata.executionId || generator.executionId !== metadata.executionId) return;
  if (!Array.isArray(generator.stepIndices) || generator.stepIndices.length !== 1 || generator.stepIndices[0] !== index)
    return;
  return object(generator.chatModel);
}

/** 单一成功生成且只对应当前回复时才配对，重试、多步骤和旧元数据均不推算。 */
export function historyGeneration(
  trajectory: ManagementRecord,
  step: ManagementRecord,
  index: number,
  usage: TokenUsage,
): GenerationTiming | undefined {
  const model = matchedModel(trajectory, step, index);
  if (!model) return;
  const retries = Array.isArray(model.retryInfos) ? model.retryInfos : [];
  if (retries.length !== 1 || !sameUsage(object(retries[0]).usage, usage) || !sameUsage(model.usage, usage)) return;
  const durationMs = milliseconds(model.streamingDuration);
  if (durationMs === undefined || durationMs <= 0 || usage.outputTokens === undefined) return;
  const firstTokenMs = milliseconds(model.timeToFirstToken);
  return { durationMs, ...(firstTokenMs === undefined ? {} : { firstTokenMs }) };
}
