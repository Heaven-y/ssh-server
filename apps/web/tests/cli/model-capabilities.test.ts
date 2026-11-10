import { expect, it } from 'vitest';
import { claudeContextModels } from '../../src/cli/claude/context-models';
import { findModel, modelDisplay } from '../../src/cli/shared/model-identity';
import { configuredModelEffort, modelDefaultEffort, modelEfforts } from '../../src/cli/model-capabilities';
import { antigravityModelSuggestions } from '../../src/cli/antigravity/model-suggestions';

it('Claude 的别名和 [1m] 匹配同一型号能力，但显示和发送身份保持原样', () => {
  const model = { id: 'sonnet', label: '工作模型', modelId: 'claude-sonnet-4-6', reasoningEfforts: ['low', 'high'] };
  expect(findModel([model], 'sonnet[1m]')).toBe(model);
  expect(modelDisplay('sonnet[1m]', model)).toBe('claude-sonnet-4-6[1m]');
  expect(modelEfforts('claude', 'sonnet[1m]', [model])).toEqual(['low', 'high']);
  expect(modelEfforts('claude', 'claude-opus-4-6[1m]', [])).toEqual(['low', 'medium', 'high', 'max']);
  expect(model.id).toBe('sonnet');
  expect(claudeContextModels('sonnet', [model])).toEqual({
    standard: 'sonnet',
    extended: 'sonnet[1m]',
    selected: false,
  });
  expect(claudeContextModels('sonnet[1M]', [model])).toEqual({
    standard: 'sonnet',
    extended: 'sonnet[1m]',
    selected: true,
  });
  const bound = { ...model, modelId: 'custom-model[1M]' };
  expect(claudeContextModels('sonnet', [bound])).toEqual({
    standard: 'custom-model',
    extended: 'sonnet[1m]',
    selected: true,
  });
  expect(claudeContextModels('custom-model', [bound])?.selected).toBe(false);
});

it('明确不支持与原生限制优先于文档，未报告才补充 GPT 6 型号', () => {
  const model = { id: 'gpt-6.1-sol', label: 'GPT 6.1 Sol' };
  expect(modelEfforts('codex', model.id, [model])).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  expect(modelEfforts('codex', model.id, [{ ...model, reasoningEfforts: [] }])).toEqual([]);
  expect(modelEfforts('codex', model.id, [{ ...model, reasoningEfforts: ['high', 'custom-effort'] }])).toEqual([
    'high',
    'custom-effort',
  ]);
  expect(modelEfforts('codex', 'unknown-model', [])).toEqual([]);
});

it('配置档位优先于型号默认，别名对应同一配置，切换其他型号不沿用不确定的默认', () => {
  const catalog = {
    agent: 'codex' as const,
    defaultModel: 'configured-model',
    defaultReasoningEffort: 'high',
    entries: [],
    warnings: [],
    models: [
      { id: 'configured-model', label: '配置模型', modelId: 'native-id', defaultReasoningEffort: 'low' },
      { id: 'other-model', label: '其他模型', defaultReasoningEffort: 'medium' },
    ],
  };
  expect(configuredModelEffort('codex', 'configured-model', catalog)).toBe('high');
  expect(configuredModelEffort('codex', 'native-id', catalog)).toBe('high');
  expect(configuredModelEffort('codex', 'other-model', catalog)).toBeUndefined();
  expect(configuredModelEffort('codex', 'other-model', { ...catalog, defaultReasoningEffort: undefined })).toBe(
    'medium',
  );
});

it('按已核实型号补充分档，不把思考开关或第三方重命名模型当作通用 effort', () => {
  expect(modelEfforts('claude', 'deepseek-flash', [])).toEqual(['low', 'high', 'max']);
  expect(modelEfforts('claude', 'kimi-k3[1m]', [])).toEqual(['low', 'high', 'max']);
  expect(modelEfforts('codex', 'glm-5.2', [])).toEqual(['high', 'max']);
  expect(modelEfforts('codex', 'qwen3.8-max', [])).toEqual(['none', 'low', 'medium', 'xhigh']);
  for (const id of ['deepseek-reasoner', 'deepseek-flash-free', 'kimi-k2.6', 'glm-4.7', 'qwen3.5-plus'])
    expect(modelEfforts('codex', id, [])).toEqual([]);
  expect(modelEfforts('claude', 'qwen3.8-max', [])).toEqual([]);
});

it('AGY 只使用目录中的同族变体，自定义键不借用底层 API 的档位', () => {
  const models = ['gemini-3.1-pro-low', 'gemini-3.1-pro-high', 'different-model-max'].map((id) => ({ id, label: id }));
  expect(modelEfforts('antigravity', models[0]!.id, models)).toEqual(['low', 'high']);
  expect(modelDefaultEffort('antigravity', models[0]!.id, models)).toBe('low');
  const custom = { id: 'my-model', label: '我的模型', modelId: 'gemini-3.1-flash' };
  expect(modelDisplay(custom.id, custom)).toBe('gemini-3.1-flash');
  expect(modelEfforts('antigravity', custom.id, [...models, custom])).toEqual([]);
});

it('AGY 同名建议仅合并明确指向原生条目的别名，保留当前身份及其他同名型号', () => {
  const native = { id: 'example-high', label: 'Example (High)' };
  const alias = { id: 'configured', label: native.label, modelId: native.id };
  expect(antigravityModelSuggestions([native, alias], alias.id)).toEqual([{ value: alias.id, label: native.label }]);
  expect(antigravityModelSuggestions([native, alias], '')).toEqual([{ value: native.id, label: native.label }]);
  const other = { ...alias, modelId: 'unrelated-model' };
  expect(antigravityModelSuggestions([native, other], '')).toEqual([
    { value: native.id, label: 'Example (High)（example-high）' },
    { value: other.id, label: 'Example (High)（configured）' },
  ]);
});
