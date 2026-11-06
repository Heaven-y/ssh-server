import type { WorkbenchPluginManifest } from '@agentdeck/shared/plugins';
export const SSH_CONSOLE_MANIFEST: WorkbenchPluginManifest = {
  id: 'ssh-console',
  name: 'SSH Console',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.html',
  description: '内置服务器控制台，提供独立服务器页面、资源、文件和终端。',
  permissions: [],
  commands: [{ id: 'open', title: '打开 SSH Console' }],
};
export const sshConsoleDefinition = { manifest: SSH_CONSOLE_MANIFEST, defaultEnabled: true };
