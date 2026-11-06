import type { AgentKind } from '@agentdeck/shared/conversation';
import type { NativeSessionRow } from '../agents/contracts';
import { createSharedRead } from './shared-read';

/** 兼容全量入口仅共享在途读取；日常界面使用独立分页缓存。 */
export function createSessionCatalog() {
  const entries = new Map<string, ReturnType<typeof createSharedRead<NativeSessionRow[]>>>();
  return {
    read(
      agent: AgentKind,
      archived: boolean,
      load: (signal: AbortSignal) => Promise<NativeSessionRow[]>,
      signal?: AbortSignal,
    ) {
      const key = `${agent}:${archived}`;
      let entry = entries.get(key);
      if (!entry || entry.controller.signal.aborted) {
        const current = createSharedRead(async (abort) => {
          try {
            const rows = await load(abort);
            if (rows.length > 100000) throw new Error('会话元数据超过上限');
            return rows;
          } finally {
            if (entries.get(key) === current) entries.delete(key);
          }
        });
        entries.set(key, current);
        entry = current;
      }
      return entry.subscribe(signal);
    },
  };
}
