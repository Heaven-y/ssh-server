import type { AgentCapability } from '@ssh-server/shared';

/** 目录保留全部原生条目，常用入口只展示已接通网页调用的能力。 */
export function isInvocableCapability(entry: AgentCapability): boolean {
  return entry.available === true;
}

export function capabilityRestriction(capability: AgentCapability, sessionId?: string): string | undefined {
  if (!capability.available) return capability.unavailableReason || '该能力暂不可在网页调用';
  if (capability.requiresSession && !sessionId) return '请先打开已有会话';
  return undefined;
}

export function selectionRestriction(
  capability: AgentCapability | undefined,
  sessionId: string | undefined,
  text: string,
) {
  if (!capability) return undefined;
  return (
    capabilityRestriction(capability, sessionId) ||
    (!capability.supportsArguments && text.trim() ? '该命令不支持附加文本，请清空输入后再发送' : undefined)
  );
}
