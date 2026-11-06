import type { PermissionChoice } from '../shared/permission-choice';

export const codexPermissions: PermissionChoice[] = [
  { label: '请求批准', description: '工作区内执行，需要额外权限时询问你', selection: { agent: 'codex', mode: 'ask' } },
  {
    label: '帮我批准',
    description: '保持工作区沙箱，由 Codex 自动审查权限请求',
    selection: { agent: 'codex', mode: 'auto-review' },
  },
  {
    label: '完全访问',
    description: '关闭 Codex 沙箱，不再请求批准',
    selection: { agent: 'codex', mode: 'full-access' },
  },
];
