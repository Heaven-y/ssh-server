import type { SshConsoleDeps, SshConsoleService } from './types';
import { createConsoleAccess } from './access';
import { createConsoleFiles } from './files';
import { createConsoleTerminals } from './terminals';
import { createConsoleMetrics } from './metrics';
export type { SshConsoleDeps, SshConsoleService } from './types';

export function createSshConsoleService(deps: SshConsoleDeps): SshConsoleService {
  const access = createConsoleAccess(deps);
  const files = createConsoleFiles(deps.pool, access);
  const terminals = createConsoleTerminals(deps.pool, access);
  const metrics = createConsoleMetrics(deps.pool, access);
  return {
    ...metrics,
    ...files,
    ...terminals,
    dispose() {
      terminals.dispose();
      access.dispose();
      metrics.dispose();
    },
  };
}
