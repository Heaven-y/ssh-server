import { expect, it } from 'vitest';
import { antigravityHistory } from '../../../src/agents/antigravity/history';

function fixture() {
  const usage = { inputTokens: '100', outputTokens: '25', thinkingOutputTokens: '5', responseOutputTokens: '20' };
  return {
    cascadeId: 'synthetic-session',
    steps: [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        plannerResponse: { response: '合成回复' },
        metadata: {
          modelUsage: usage,
          executionId: 'run',
          sourceTrajectoryStepInfo: { metadataIndex: 0, stepIndex: 0, cascadeId: 'synthetic-session' },
        },
      },
    ],
    generatorMetadata: [
      {
        stepIndices: [0],
        executionId: 'run',
        chatModel: {
          usage,
          timeToFirstToken: '0.150s',
          streamingDuration: '0.200s',
          retryInfos: [{ usage }],
        },
      },
    ],
  };
}

it('原生历史将同一次生成的首段等待和流式耗时与工具耗时分开', () => {
  const events = antigravityHistory(fixture());
  expect(events.find((event) => event.type === 'step_usage')).toMatchObject({
    usage: { outputTokens: 25, reasoningOutputTokens: 5 },
    generation: { firstTokenMs: 150, durationMs: 200 },
  });
  expect(events.find((event) => event.type === 'step_usage')).not.toHaveProperty('durationMs');
});

it('生成索引、执行身份、用量不一致或多步骤共用生成时隐藏计时', () => {
  const changes = [
    (value: ReturnType<typeof fixture>) => {
      value.steps[0]!.metadata.sourceTrajectoryStepInfo.metadataIndex = 2;
    },
    (value: ReturnType<typeof fixture>) => {
      value.steps[0]!.metadata.sourceTrajectoryStepInfo.stepIndex = 3;
    },
    (value: ReturnType<typeof fixture>) => {
      value.steps[0]!.metadata.sourceTrajectoryStepInfo.cascadeId = 'other';
    },
    (value: ReturnType<typeof fixture>) => {
      value.generatorMetadata[0]!.executionId = 'other';
    },
    (value: ReturnType<typeof fixture>) => {
      value.generatorMetadata[0]!.stepIndices.push(1);
    },
    (value: ReturnType<typeof fixture>) => {
      value.generatorMetadata[0]!.chatModel.usage = {
        ...value.generatorMetadata[0]!.chatModel.usage,
        outputTokens: '26',
      };
    },
  ];
  for (const change of changes) {
    const value = fixture();
    change(value);
    expect(antigravityHistory(value).find((event) => event.type === 'step_usage')).not.toHaveProperty('generation');
  }
});

it('多次尝试与非法生成时间不算生成速度', () => {
  const value = fixture();
  value.generatorMetadata[0]!.chatModel.retryInfos.push({ usage: value.generatorMetadata[0]!.chatModel.usage });
  expect(antigravityHistory(value).find((event) => event.type === 'step_usage')).not.toHaveProperty('generation');
  for (const duration of ['0s', '-1s', 'Infinitys', '100000000000000s', '1e3s', '']) {
    const value = fixture();
    value.generatorMetadata[0]!.chatModel.streamingDuration = duration;
    expect(antigravityHistory(value).find((event) => event.type === 'step_usage')).not.toHaveProperty('generation');
  }
});
