import type { AgentKind } from '@agentdeck/shared';
import type { NativeSessionRow } from '../agents/types';

type Entry = { controller: AbortController; pending: Promise<NativeSessionRow[]>; users: number; done: boolean };

/** 六个元数据槽共享并发读取；不缓存正文，最后一个调用方取消才终止原生请求。 */
export function createSessionCatalog() {
  const entries = new Map<string, Entry>();
  function subscribe(entry: Entry, signal?: AbortSignal): Promise<NativeSessionRow[]> {
    entry.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', abort);
        if (--entry.users === 0 && !entry.done) entry.controller.abort();
        return true;
      };
      const abort = () => {
        if (finish()) reject(new Error('会话读取已取消'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      entry.pending.then(
        (rows) => {
          if (finish()) resolve(rows);
        },
        (error: unknown) => {
          if (finish()) reject(error instanceof Error ? error : new Error('原生会话元数据读取失败'));
        },
      );
    });
  }
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
        const controller = new AbortController();
        const current: Entry = { controller, users: 0, done: false, pending: Promise.resolve([]) };
        current.pending = Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted();
            return load(controller.signal);
          })
          .then((rows) => {
            if (rows.length > 100000) throw new Error('会话元数据超过上限');
            return rows;
          })
          .finally(() => {
            current.done = true;
            if (entries.get(key) === current) entries.delete(key);
          });
        entries.set(key, current);
        entry = current;
      }
      return subscribe(entry, signal);
    },
  };
}
