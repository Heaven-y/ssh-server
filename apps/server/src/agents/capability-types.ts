import { createHash } from 'node:crypto';
import type { AgentCapability, AgentKind, AgentModel } from '@ssh-server/shared';

export type NativeInvocation =
  { kind: 'skill'; name: string; path?: string } | { kind: 'command'; name: 'compact' | 'context' };
/** invocation 只在后端持有，不能将客户端路径直接用作技能输入。 */
export type NativeCapabilityCatalog = {
  entries: Array<AgentCapability & { invocation?: NativeInvocation }>;
  models: AgentModel[];
  warnings: string[];
};
export type CapabilityProvider = (dir: string, signal?: AbortSignal) => Promise<NativeCapabilityCatalog>;
export function capabilityId(agent: AgentKind, ...identity: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([agent, ...identity]))
    .digest('hex');
}
