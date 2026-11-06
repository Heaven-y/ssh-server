import type { AgentCapabilities } from '@agentdeck/shared/conversation';

export function commandWarnings(catalog?: AgentCapabilities): string[] {
  return catalog?.commandWarnings ?? catalog?.warnings ?? [];
}

export function currentCapabilityError(
  current: boolean,
  refresh: { isError: boolean; error: Error | null },
  queryError: Error | null,
) {
  return current && refresh.isError ? refresh.error : queryError;
}
