import type { LaunchVariable } from '../../common/configuration/contracts';
export const launchVariables: LaunchVariable[] = [
  { name: 'ANTHROPIC_API_KEY', label: 'API 密钥', sensitive: true },
  { name: 'ANTHROPIC_AUTH_TOKEN', label: '认证令牌', sensitive: true },
  { name: 'ANTHROPIC_BASE_URL', label: 'API 地址', sensitive: false },
];
