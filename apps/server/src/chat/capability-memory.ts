import type { AgentKind } from '@agentdeck/shared/conversation';

const MAX_DIRECTORIES = 32;
const MAX_BYTES = 2 * 1024 * 1024;

/** 最近访问顺序只控制内存生命周期，不决定不同目录的配置是否相同。 */
export function createCapabilityRetention(protectedKey: (key: string) => boolean, remove: (key: string) => void) {
  const entries = new Map<string, { agent: AgentKind; bytes: number }>();
  function touch(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    entries.set(key, entry);
  }
  function trim(agent: AgentKind) {
    const matching = [...entries].filter(([, entry]) => entry.agent === agent);
    let count = matching.length;
    let bytes = matching.reduce((total, [, entry]) => total + entry.bytes, 0);
    // 最新的一份目录即使较大也保持可用；刷新中的旧结果须留给失败回退。
    const newest = matching.at(-1)?.[0];
    for (const [key, entry] of matching) {
      if (count <= MAX_DIRECTORIES && bytes <= MAX_BYTES) break;
      if (key === newest || protectedKey(key)) continue;
      entries.delete(key);
      remove(key);
      count--;
      bytes -= entry.bytes;
    }
  }
  return {
    touch,
    trim,
    delete: (key: string) => entries.delete(key),
    record(key: string, agent: AgentKind, value: unknown) {
      entries.set(key, { agent, bytes: Buffer.byteLength(JSON.stringify(value ?? null)) });
      touch(key);
      trim(agent);
    },
  };
}
