import type { TerminalTarget, TerminalBinding } from '@agentdeck/shared/ssh';
import { request } from '../../../../lib/http';

export const terminalApi = {
  bindTerminalTarget: (target: TerminalTarget, options: { signal?: AbortSignal; previousBinding?: string } = {}) =>
    request<TerminalBinding>(`/api/workspaces/${encodeURIComponent(target.workspaceId)}/terminal-binding`, {
      method: 'POST',
      cache: 'no-store',
      signal: options.signal,
      body: JSON.stringify({ target, previousBinding: options.previousBinding }),
    }),
};
