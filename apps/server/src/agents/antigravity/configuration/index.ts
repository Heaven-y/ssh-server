import type { CliConfiguration } from '../../common/configuration/contracts';
import { NativeConfigError } from '../../common/configuration/legacy-errors';
import { validateUrl } from '../../common/configuration/patch';
import {
  antigravityConnectionChanges,
  modelConnectionFields,
  modelEnvironmentWarnings,
  nativeModelChanges,
  prepareModelConnection,
  readModelEnvironment,
} from './environment';
import { antigravityFields } from './fields';
import { launchVariables } from './launch';
import { patch } from './patch';
import { antigravityPlan } from './resources';
import { antigravitySelectionChanges, nativeAntigravityModels } from './selection';
export const configuration: CliConfiguration = {
  format: 'json',
  patch,
  resources: antigravityPlan,
  launchVariables,
  instructionNames: ['AGENTS.md', 'GEMINI.md'],
  readEnvironment: readModelEnvironment,
  describe: (config, snapshot) => ({
    fields: [...antigravityFields(config), ...modelConnectionFields(snapshot)],
    warnings: modelEnvironmentWarnings(config.modelProvider, snapshot),
  }),
  advancedWarnings: () => Promise.resolve([]),
  async prepare(config, input, snapshot, services) {
    const changes = antigravityConnectionChanges(input, config, snapshot);
    validateUrl(changes.baseUrl);
    const native = await antigravitySelectionChanges(
      config,
      nativeModelChanges(changes, snapshot),
      services.modelCatalog ?? nativeAntigravityModels,
    );
    return { changes: native, connection: prepareModelConnection(changes, services.environment, snapshot) };
  },
  launchNote:
    'Gemini API 密钥须配合原生 settings.json 的 modelProvider="gemini"；ADC 使用 AGY_ADC_AUTH=true。保存用于新启动的 CLI，旧值不会回填。',
  validateVariable(name, value) {
    if (name === 'AGY_ADC_AUTH' && !['true', 'false'].includes(value)) throw new NativeConfigError('invalid_request');
  },
};
