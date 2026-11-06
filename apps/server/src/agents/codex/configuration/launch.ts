import type { LaunchVariable } from '../../common/configuration/contracts';
export const launchVariables: LaunchVariable[] = [
  { name: 'OPENAI_API_KEY', label: 'API 密钥', sensitive: true },
  { name: 'OPENAI_BASE_URL', label: 'API 地址', sensitive: false },
];
