import { z } from 'zod';

export const DEFAULT_POLICY_RULE_IDS = [
  'privilege',
  'rm-dangerous',
  'mkfs',
  'dd-device',
  'power',
  'kill-all',
  'chmod-777-recursive',
  'authorized-keys',
  'fork-bomb',
  'crontab-remove',
] as const;
export type DefaultPolicyRuleId = (typeof DEFAULT_POLICY_RULE_IDS)[number];
export const DEFAULT_POLICY_RULE_REASONS: Record<DefaultPolicyRuleId, string> = {
  privilege: '禁止提权命令（sudo、su、doas、pkexec）',
  'rm-dangerous': '禁止递归删除根目录、家目录、当前目录、上级目录或工作区目录本身',
  mkfs: '禁止格式化文件系统',
  'dd-device': '禁止用 dd 写入设备文件',
  power: '禁止关机或重启服务器',
  'kill-all': '禁止向所有进程发送信号（目标为 -1）',
  'chmod-777-recursive': '禁止递归设置 777 权限',
  'authorized-keys': '禁止写入、移动或删除 SSH 授权密钥文件 authorized_keys',
  'fork-bomb': '禁止 fork 炸弹',
  'crontab-remove': '禁止删除全部定时任务（crontab -r）',
};

export const MAX_CUSTOM_POLICY_RULES = 20;
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, '不能为空')
    .max(max)
    .regex(/^\P{Cc}+$/u, '不能包含控制字符');
export const CustomPolicyRuleSchema = z
  .object({
    id: z.string().regex(/^custom-[A-Za-z0-9-]{1,64}$/, '自定义规则标识不合法'),
    kind: z.enum(['program', 'contains']),
    pattern: text(256),
    reason: text(160),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.kind === 'program' && !/^[A-Za-z0-9_+.-]+$/.test(rule.pattern))
      ctx.addIssue({ code: 'custom', path: ['pattern'], message: '程序名仅限字母数字及 _ + . -，不含路径或空格' });
  });
export type CustomPolicyRule = z.infer<typeof CustomPolicyRuleSchema>;

export const WorkspacePolicySchema = z
  .object({
    disabledRules: z.array(z.enum(DEFAULT_POLICY_RULE_IDS)).max(DEFAULT_POLICY_RULE_IDS.length).optional(),
    customRules: z.array(CustomPolicyRuleSchema).max(MAX_CUSTOM_POLICY_RULES).optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    for (const [key, ids] of [
      ['disabledRules', policy.disabledRules ?? []],
      ['customRules', (policy.customRules ?? []).map((rule) => rule.id)],
    ] as const) {
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [key], message: '规则标识不能重复' });
    }
  });
export type WorkspacePolicy = z.infer<typeof WorkspacePolicySchema>;
export const WorkspacePolicyInputSchema = z
  .object({ policy: WorkspacePolicySchema, revision: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type WorkspacePolicyInput = z.infer<typeof WorkspacePolicyInputSchema>;
export type WorkspacePolicyDocument = { policy: WorkspacePolicy; revision: string };
