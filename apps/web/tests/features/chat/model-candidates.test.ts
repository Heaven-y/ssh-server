import { expect, it } from 'vitest';
import { matchingModels, modelCandidates } from '../../../src/features/chat/model-candidates';

const models = ['one', 'two', 'new'].map((id) => ({ id, label: id }));
it('只列选中范围，保留当前模型身份且不自动纳入刷新后的新型号', () => {
  expect(modelCandidates(models, 'two', ['one']).map((model) => model.id)).toEqual(['two', 'one']);
  expect(modelCandidates(models, '', []).map((model) => model.id)).toEqual([]);
  expect(modelCandidates(models, '', undefined)).toEqual(models);
  expect(modelCandidates(models, 'manual', ['one']).map((model) => model.id)).toEqual(['manual', 'one']);
});

const native = { id: 'gemini-example-high', label: 'Gemini Example (High)' };
const alias = { id: 'configured', label: native.label, modelId: native.label };

it('AGY 合并原生型号与明确对应的配置名称，保留当前身份和两种检索入口', () => {
  for (const current of [alias.id, alias.modelId, native.id]) {
    const candidates = modelCandidates([native, alias], current, undefined, 'antigravity');
    expect(candidates.map((model) => model.id)).toEqual([current === native.id ? native.id : alias.id]);
    expect(matchingModels(candidates, native.id)).toHaveLength(1);
    expect(matchingModels(candidates, native.label)).toHaveLength(1);
  }
  expect(modelCandidates([native, alias], alias.id, [native.id], 'antigravity').map((model) => model.id)).toEqual([
    alias.id,
  ]);
  expect(modelCandidates([native, alias], '', [alias.id], 'antigravity').map((model) => model.id)).toEqual([alias.id]);
  expect(modelCandidates([native, alias], '', [], 'antigravity')).toEqual([]);
});

it('同名但底层型号不同、多个配置入口及其他 CLI 均不误合并', () => {
  const unrelated = { ...alias, modelId: 'different-model' };
  const ambiguous = [native, alias, { ...alias, id: 'other-config' }];
  expect(modelCandidates([native, unrelated], alias.id, undefined, 'antigravity')).toHaveLength(2);
  expect(modelCandidates(ambiguous, alias.id, undefined, 'antigravity')).toHaveLength(3);
  for (const catalog of [ambiguous, ambiguous.slice(1)]) {
    expect(modelCandidates(catalog, native.label, [alias.id], 'antigravity').map((model) => model.id)).toEqual([
      native.label,
      alias.id,
    ]);
  }
  expect(modelCandidates([native, alias], alias.id, undefined, 'claude')).toHaveLength(2);
  expect(modelCandidates([native, alias], alias.id, undefined, 'codex')).toHaveLength(2);
});

it('AGY 旧会话以显示名记录当前模型时，保留原始发送值并合并已确认的目录身份', () => {
  const catalog = [native, { ...alias, modelId: native.id }];
  for (const visible of [undefined, [native.id], [alias.id], []]) {
    const candidates = modelCandidates(catalog, native.label, visible, 'antigravity');
    expect(candidates.map((model) => model.id)).toEqual([native.label]);
    expect(matchingModels(candidates, native.id)).toHaveLength(1);
  }
});
