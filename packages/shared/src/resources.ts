/** 资源指标只来自实际SSH节点；null表示缺失，不能当作零。 */
export const RESOURCE_LIMITS = {
  intervalMs: 5000,
  staleMs: 15000,
  timeoutMs: 8000,
  outputBytes: 128 * 1024,
  idleMs: 60000,
  hostEntries: 64,
  diskEntries: 128,
  processes: 50,
  gpuProcesses: 100,
} as const;

export type ResourceGpu = {
  index: number;
  uuid: string;
  name: string;
  utilization: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  temperature: number | null;
  power: number | null;
};
export type ResourceProcess = {
  pid: number;
  command: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  gpus: Array<{ uuid: string; memoryBytes: number | null }>;
};
export type ResourceHost = {
  hostname: string | null;
  cpuPercent: number | null;
  load: [number, number, number] | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  gpus: ResourceGpu[] | null;
  processes: ResourceProcess[] | null;
  gpuProcessesAvailable: boolean;
};
export type ResourceDisk = { totalBytes: number; availableBytes: number };
export type ResourceReading<T> = {
  data: T | null;
  sampledAt: number | null;
  stale: boolean;
  message: string | null;
  retryAt: number | null;
};
export type ResourceSnapshot = {
  workspaceId: string;
  sshHost: string;
  remoteDir: string;
  host: ResourceReading<ResourceHost>;
  disk: ResourceReading<ResourceDisk>;
};
