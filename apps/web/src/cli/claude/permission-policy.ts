import type { PermissionChoice } from '../shared/permission-choice';

export const claudePermissions: PermissionChoice[] = [
  { label: '手动审批', description: '由你回答原生权限请求', selection: { agent: 'claude', mode: 'default' } },
  {
    label: '接受编辑',
    description: '自动接受文件编辑，其他请求仍按原生规则处理',
    selection: { agent: 'claude', mode: 'acceptEdits' },
  },
  { label: '自动审查', description: 'Claude auto，由原生分类器审查操作', selection: { agent: 'claude', mode: 'auto' } },
  { label: '计划模式', description: '探索与规划，不直接编辑源文件', selection: { agent: 'claude', mode: 'plan' } },
  { label: '不询问', description: '需要询问的操作由原生拒绝', selection: { agent: 'claude', mode: 'dontAsk' } },
  {
    label: '跳过权限检查',
    description: '使用原生 bypassPermissions 模式',
    selection: { agent: 'claude', mode: 'bypassPermissions' },
  },
];
