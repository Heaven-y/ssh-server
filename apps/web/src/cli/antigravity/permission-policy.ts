import type { PermissionChoice } from '../shared/permission-choice';

export const antigravityPermissions: PermissionChoice[] = [
  {
    label: '接受编辑',
    description: '使用原生 accept-edits 模式',
    selection: { agent: 'antigravity', mode: 'accept-edits' },
  },
  {
    label: '自动模式',
    description: '使用 Antigravity 原生 auto 模式',
    selection: { agent: 'antigravity', mode: 'auto' },
  },
  { label: '计划模式', description: '使用原生 plan 模式', selection: { agent: 'antigravity', mode: 'plan' } },
  {
    label: '跳过权限检查',
    description: '自动允许原生工具权限请求',
    selection: { agent: 'antigravity', mode: 'bypass' },
  },
];
