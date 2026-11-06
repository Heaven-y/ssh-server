import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { WorkbenchPlugin } from '@agentdeck/shared/plugins';
import type { Workspace } from '@agentdeck/shared/projects';
export type BuiltinPluginPageProps = {
  visible: boolean;
  project?: Workspace;
  close(): void;
  command?: { id: string; sequence: number };
};
export type BuiltinPluginRegistration = {
  id: string;
  Page: LazyExoticComponent<ComponentType<BuiltinPluginPageProps>>;
  Icon: LucideIcon;
  priority: number;
  disableConfirmation(plugin: WorkbenchPlugin): string;
  onDisabled(): void;
};
