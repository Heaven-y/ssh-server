import type { CliConfiguration } from '../../common/configuration/contracts';
import { advancedModelEnvironmentWarnings, nativeConfigurationDefaults } from '../../common/configuration/environment';
import { object, string } from '../../common/configuration/fields';
import { codexFields } from './fields';
import { launchVariables } from './launch';
import { patch } from './patch';
import { codexPlan } from './resources';
export const configuration: CliConfiguration = {
  ...nativeConfigurationDefaults,
  format: 'toml',
  patch,
  resources: codexPlan,
  launchVariables,
  instructionNames: ['AGENTS.md', 'AGENTS.override.md'],
  describe: (config) => ({
    ...codexFields(config),
    warnings: config.profile ? ['检测到旧版 profile 选择；新版 CLI 的 profile 格式已变化，请在原始配置中核对。'] : [],
  }),
  advancedWarnings(config, environment) {
    const provider = string(config.model_provider) || 'openai';
    const names =
      provider === 'openai'
        ? launchVariables.map(({ name }) => name)
        : [string(object(object(config.model_providers)[provider]).env_key)];
    return advancedModelEnvironmentWarnings('codex', names, environment);
  },
};
