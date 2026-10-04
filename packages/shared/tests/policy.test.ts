import { expect, it } from 'vitest';
import { CustomPolicyRuleSchema, WorkspacePolicySchema, WorkspacePolicyInputSchema } from '../src/policy';

const rule = { id: 'custom-demo', kind: 'program', pattern: 'python', reason: '暂不运行分析' };
it('兼容缺省和旧停用项；自定义值trim后保存且版本必填', () => {
  expect(WorkspacePolicySchema.parse({})).toEqual({});
  expect(WorkspacePolicySchema.parse({ disabledRules: ['privilege'] })).toEqual({ disabledRules: ['privilege'] });
  expect(CustomPolicyRuleSchema.parse({ ...rule, pattern: ' python ', reason: ' 原因 ' })).toMatchObject({
    pattern: 'python',
    reason: '原因',
  });
  expect(WorkspacePolicyInputSchema.safeParse({ policy: {} }).success).toBe(false);
  expect(WorkspacePolicyInputSchema.safeParse({ policy: {}, revision: 'a'.repeat(64), extra: true }).success).toBe(
    false,
  );
});
it('拒绝未知和重复默认id、自定义id、超限数量与未知字段', () => {
  for (const policy of [
    { disabledRules: ['unknown'] },
    { disabledRules: ['privilege', 'privilege'] },
    { customRules: [rule, rule] },
    { customRules: Array.from({ length: 21 }, (_, i) => ({ ...rule, id: `custom-${i}` })) },
    { customRules: [{ ...rule, id: 'privilege' }] },
    { customRules: [{ ...rule, extra: true }] },
    { extra: true },
  ])
    expect(WorkspacePolicySchema.safeParse(policy).success).toBe(false);
});
it('程序名不含路径/空格，字符串为有界字面值，原因与模式拒绝控制字符', () => {
  expect(CustomPolicyRuleSchema.safeParse({ ...rule, kind: 'contains', pattern: 'a.*(x)' }).success).toBe(true);
  for (const patch of [
    { pattern: '/bin/python' },
    { pattern: 'python x' },
    { pattern: '' },
    { pattern: 'x'.repeat(257) },
    { pattern: 'a\0b' },
    { reason: 'a\nb' },
    { reason: '' },
    { reason: 'x'.repeat(161) },
    { kind: 'regex' },
  ])
    expect(CustomPolicyRuleSchema.safeParse({ ...rule, ...patch }).success).toBe(false);
});
