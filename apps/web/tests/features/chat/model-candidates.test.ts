import { expect, it } from 'vitest';
import { modelCandidates } from '../../../src/features/chat/model-candidates';

const models = ['one', 'two', 'new'].map((id) => ({ id, label: id }));
it('只列选中范围，保留当前模型身份且不自动纳入刷新后的新型号', () => {
  expect(modelCandidates(models, 'two', ['one']).map((model) => model.id)).toEqual(['two', 'one']);
  expect(modelCandidates(models, '', []).map((model) => model.id)).toEqual([]);
  expect(modelCandidates(models, '', undefined)).toEqual(models);
  expect(modelCandidates(models, 'manual', ['one']).map((model) => model.id)).toEqual(['manual', 'one']);
});
