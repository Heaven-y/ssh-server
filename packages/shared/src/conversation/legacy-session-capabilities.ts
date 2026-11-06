import type { AgentKind } from './agents';
import type { SessionCapabilities } from './session';
/** 仅用于未携带 capabilities 的旧会话数据；新响应优先使用提供方能力。 */
export function legacySessionCapabilities(agent: AgentKind): SessionCapabilities {
  return {
    rename: agent !== 'antigravity',
    fork: agent === 'antigravity' ? null : 'native',
    delete: agent === 'antigravity' ? null : 'native',
    archive: agent === 'codex' ? 'native' : null,
  };
}
