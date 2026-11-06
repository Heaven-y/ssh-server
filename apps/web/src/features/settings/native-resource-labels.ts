import { ApiError } from '../../lib/http';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { NativeResourceKind, NativeResourceScope } from '@agentdeck/shared/settings';

export const nativeAgentNames: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};
export const nativeScopeNames: Record<NativeResourceScope, string> = {
  user: '用户',
  project: '当前项目',
  local: '个人项目',
  directory: '目录',
};
export const nativeKindNames: Record<NativeResourceKind, string> = {
  settings: '配置',
  rules: '规则',
  skills: 'Skills',
  mcp: 'MCP',
  plugins: '原生插件',
  hooks: 'Hooks',
};
export function nativeSettingsError(error: unknown) {
  return error instanceof ApiError ? error.message : '无法访问本机设置，请稍后重试。';
}
export const confirmNativeDiscard = (dirty: boolean) => !dirty || window.confirm('有未保存修改，确定放弃这些修改吗？');
