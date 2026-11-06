import type { LaunchVariable } from '../../common/configuration/contracts';
export const launchVariables: LaunchVariable[] = [
  { name: 'GEMINI_API_KEY', label: 'Gemini API 密钥', sensitive: true },
  { name: 'GOOGLE_GEMINI_BASE_URL', label: 'Gemini API 地址', sensitive: false },
  { name: 'AGY_ADC_AUTH', label: '使用 ADC 认证（true/false）', sensitive: false },
  { name: 'GOOGLE_CLOUD_QUOTA_PROJECT', label: 'ADC 配额项目', sensitive: false },
  { name: 'GOOGLE_CLOUD_LOCATION', label: 'ADC 区域', sensitive: false },
];
