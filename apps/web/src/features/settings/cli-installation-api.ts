import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallInput, CliInstallationStatus } from '@agentdeck/shared/settings';
import { request } from '../../lib/http';

const installationUrl = (agent: AgentKind) => `/api/settings/cli-installation/${agent}`;
export const cliInstallationKey = (agent: AgentKind) => ['cli-installation', agent] as const;
export const cliInstallationApi = {
  read: (agent: AgentKind, signal?: AbortSignal) =>
    request<CliInstallationStatus>(installationUrl(agent), { signal, cache: 'no-store' }),
  check: (agent: AgentKind) =>
    request<CliInstallationStatus>(`${installationUrl(agent)}/check`, {
      method: 'POST',
      body: '{}',
      cache: 'no-store',
    }),
  operate: (agent: AgentKind, input: CliInstallInput) =>
    request<CliInstallationStatus>(`${installationUrl(agent)}/operations`, {
      method: 'POST',
      body: JSON.stringify(input),
      cache: 'no-store',
    }),
};
