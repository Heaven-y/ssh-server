import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionSelection } from '@agentdeck/shared/conversation';

export function claudePermissionOptions(
  selection?: PermissionSelection,
): Pick<Options, 'permissionMode' | 'allowDangerouslySkipPermissions'> {
  if (selection?.agent !== 'claude') return {};
  return {
    permissionMode: selection.mode,
    ...(selection.mode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
  };
}
