import { randomUUID } from 'node:crypto';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { NativeSessionPage } from '../agents/contracts';
import { createSharedRead } from './shared-read';

type Read = ReturnType<typeof createSharedRead<NativeSessionPage>>;
type Entry = { agent: AgentKind; read: Read; bytes: number; done: boolean };
const MAX_PAGES = 32;
const MAX_BYTES = 4 * 1024 * 1024;

/** 按原生页共享结果，目录与搜索只做投影；写操作按来源失效，不靠轮询。 */
export function createSessionPageCache() {
  const entries = new Map<string, Entry>();
  const epoch = randomUUID();
  const generations: Partial<Record<AgentKind, number>> = {};
  const revision = (agent: AgentKind) => `${epoch}:${generations[agent] ?? 0}`;
  function trim() {
    let bytes = [...entries.values()].reduce((sum, item) => sum + item.bytes, 0);
    for (const [key, entry] of entries) {
      if (entries.size <= MAX_PAGES && bytes <= MAX_BYTES) break;
      if (entry.done) {
        entries.delete(key);
        bytes -= entry.bytes;
      }
    }
  }
  function create(key: string, agent: AgentKind, load: (signal: AbortSignal) => Promise<NativeSessionPage>) {
    const read = createSharedRead(async (signal) => {
      try {
        const result = await load(signal);
        signal.throwIfAborted();
        const data = structuredClone(result);
        const entry = entries.get(key);
        if (entry?.read === read) {
          entry.bytes = Buffer.byteLength(JSON.stringify(data));
          entry.done = true;
          trim();
        }
        return data;
      } catch (error) {
        if (entries.get(key)?.read === read) entries.delete(key);
        throw error;
      }
    });
    const entry = { agent, read, bytes: 0, done: false };
    entries.set(key, entry);
    return entry;
  }
  return {
    revision,
    invalidate(agent: AgentKind) {
      generations[agent] = (generations[agent] ?? 0) + 1;
      for (const [key, entry] of entries) {
        if (entry.agent !== agent) continue;
        entry.read.controller.abort();
        entries.delete(key);
      }
    },
    read(
      source: { agent: AgentKind; archived: boolean; cursor?: string; reader?: string },
      load: (signal: AbortSignal) => Promise<NativeSessionPage>,
      signal?: AbortSignal,
    ) {
      const key = JSON.stringify([source.agent, source.archived, source.cursor, source.reader, revision(source.agent)]);
      let entry = entries.get(key);
      if (!entry || entry.read.controller.signal.aborted) entry = create(key, source.agent, load);
      entries.delete(key);
      entries.set(key, entry);
      return entry.read.subscribe(signal);
    },
  };
}
