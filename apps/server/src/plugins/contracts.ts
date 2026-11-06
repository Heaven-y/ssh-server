import type { WorkbenchPluginManifest } from '@agentdeck/shared/plugins';
import type { FastifyInstance } from 'fastify';
export type BuiltinPluginDefinition = { manifest: WorkbenchPluginManifest; defaultEnabled: boolean };
export type BuiltinPluginRegistration = BuiltinPluginDefinition & {
  registerRoutes(app: FastifyInstance): void;
  disable(): Promise<void> | void;
  dispose(): Promise<void> | void;
};
