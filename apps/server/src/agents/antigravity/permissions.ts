import type { PermissionSelection } from '@agentdeck/shared/conversation';

export function antigravityPermissionArgs(selection?: PermissionSelection): string[] {
  if (selection?.agent !== 'antigravity') return [];
  return selection.mode === 'bypass' ? ['--dangerously-skip-permissions'] : ['--mode', selection.mode];
}
