import { ProductSettingsSchema, type ManagedServer, type ResourceSnapshot, type Workspace } from '@ssh-server/shared';

export const workspace: Workspace = {
  id: 'w1',
  name: '示例项目',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
  localDir: 'project',
};
export const server: ManagedServer = {
  alias: 'my-server',
  name: '实验服务器',
  hostname: 'example.invalid',
  port: 22,
  username: 'researcher',
  authMode: 'password',
};
export const credentials = { saved: false, savingAvailable: true, paused: false, connected: true, hasPassword: true };
export const settings = {
  settings: ProductSettingsSchema.parse({ resources: { intervalSeconds: 2 } }),
  revision: 'missing',
};
export const snapshot = (): ResourceSnapshot => ({
  workspaceId: 'w1',
  sshHost: 'my-server',
  remoteDir: '~/projects/demo',
  host: {
    data: {
      hostname: 'node',
      cpuPercent: null,
      memoryUsed: null,
      memoryTotal: null,
      load: null,
      gpus: null,
      processes: null,
      gpuProcessesAvailable: false,
    },
    sampledAt: Date.now(),
    stale: false,
    message: null,
    retryAt: null,
  },
  disk: { data: null, sampledAt: null, stale: true, message: '磁盘不可用', retryAt: null },
});
