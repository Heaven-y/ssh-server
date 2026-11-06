import type { CliConfiguration } from '../../common/configuration/contracts';
import { advancedModelEnvironmentWarnings, nativeConfigurationDefaults } from '../../common/configuration/environment';
import { claudeFields } from './fields';
import { launchVariables } from './launch';
import { patch } from './patch';
import { claudePlan } from './resources';
export const configuration: CliConfiguration = {
  ...nativeConfigurationDefaults,
  format: 'json',
  patch,
  resources: claudePlan,
  launchVariables,
  instructionNames: ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'],
  describe: (config) => ({ fields: claudeFields(config), warnings: [] }),
  advancedWarnings: (_config, environment) =>
    advancedModelEnvironmentWarnings(
      'claude',
      launchVariables.map(({ name }) => name),
      environment,
    ),
};
