import type { AgentKind, AgentModel } from '@agentdeck/shared/conversation';
import type {
  LaunchEnvironmentDocument,
  LaunchEnvironmentInput,
  NativeModelSettingsDocument,
  NativeModelSettingsInput,
} from '@agentdeck/shared/settings';
import type { ConfigObject } from './fields';
import type { Builder, ResourceContext } from './resources';
export type ModelSettingsEnvironment = {
  read(agent: AgentKind): Promise<LaunchEnvironmentDocument>;
  save(agent: AgentKind, input: LaunchEnvironmentInput): Promise<LaunchEnvironmentDocument>;
  resolve(agent: AgentKind): Promise<NodeJS.ProcessEnv>;
};
export type EnvironmentSnapshot = { document: LaunchEnvironmentDocument; resolved: NodeJS.ProcessEnv };
export type ConfigurationServices = {
  environment?: ModelSettingsEnvironment;
  modelCatalog?: () => Promise<AgentModel[]>;
};
export type ConnectionTransaction = {
  save(): Promise<EnvironmentSnapshot | undefined>;
  restore(saved: EnvironmentSnapshot | undefined): Promise<void>;
};
export type LaunchVariable = { name: string; label: string; sensitive: boolean };
export type CliConfiguration = {
  format: 'json' | 'toml';
  describe(
    config: ConfigObject,
    snapshot?: EnvironmentSnapshot,
  ): Pick<NativeModelSettingsDocument, 'fields' | 'providers' | 'warnings'>;
  patch(content: string, config: ConfigObject, changes: NativeModelSettingsInput['changes']): string;
  readEnvironment(environment?: ModelSettingsEnvironment): Promise<EnvironmentSnapshot | undefined>;
  prepare(
    config: ConfigObject,
    changes: NativeModelSettingsInput['changes'],
    snapshot: EnvironmentSnapshot | undefined,
    services: ConfigurationServices,
  ): Promise<{ changes: NativeModelSettingsInput['changes']; connection: ConnectionTransaction }>;
  advancedWarnings(config: ConfigObject, environment?: ModelSettingsEnvironment): Promise<string[]>;
  resources(context: ResourceContext, output: Builder): void;
  instructionNames: string[];
  launchVariables: LaunchVariable[];
  launchNote: string;
  validateVariable?(name: string, value: string): void;
};
