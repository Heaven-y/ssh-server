import type { TerminalTarget, ResourceSnapshot, SlurmSnapshot } from '@agentdeck/shared/ssh';
import { request } from '../../../../lib/http';

export const resourcesApi = {
  readResources: (target: TerminalTarget, signal?: AbortSignal) =>
    request<ResourceSnapshot>(
      `/api/workspaces/${encodeURIComponent(target.workspaceId)}/resources?target=${encodeURIComponent(JSON.stringify(target))}`,
      { signal, cache: 'no-store' },
    ),
  readSlurm: (target: TerminalTarget, signal?: AbortSignal) =>
    request<SlurmSnapshot>(
      `/api/workspaces/${encodeURIComponent(target.workspaceId)}/slurm?target=${encodeURIComponent(JSON.stringify(target))}`,
      { signal, cache: 'no-store' },
    ),
};
