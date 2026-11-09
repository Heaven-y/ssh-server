import { create } from 'zustand';
import { z } from 'zod';
import type { SessionSummary } from '@agentdeck/shared/conversation';

const KEY = 'agentdeck.session-order.v1';
const Mode = z.enum(['recent', 'name', 'manual']);
export type SessionSortMode = z.infer<typeof Mode>;
const Saved = z.object({
  mode: Mode,
  orders: z.record(z.string(), z.array(z.string().max(512)).max(2000)),
});
const defaults: z.infer<typeof Saved> = { mode: 'recent', orders: {} };
export const sessionOrderKey = (session: Pick<SessionSummary, 'agent' | 'sessionId'>) =>
  JSON.stringify([session.agent, session.sessionId]);
const recentFirst = (a: SessionSummary, b: SessionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/** 已知身份沿用当前顺序，未加载身份留在原有间隔。 */
function mergeCurrentOrder(previous: string[], current: string[]) {
  const ids = [...new Set(current)];
  const currentIds = new Set(ids);
  let index = 0;
  const order = [...new Set(previous)].map((id) => (currentIds.has(id) ? (ids[index++] ?? id) : id));
  return [...order, ...ids.slice(index)];
}

export function sortSessions<T extends SessionSummary>(sessions: T[], mode: SessionSortMode, order: string[] = []) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return sessions.toSorted((a, b) => {
    if (mode === 'name') return a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) || recentFirst(a, b);
    if (mode === 'manual') {
      const rank = (id: string) => positions.get(id) ?? order.length;
      const difference = rank(sessionOrderKey(a)) - rank(sessionOrderKey(b));
      if (difference) return difference;
    }
    return recentFirst(a, b);
  });
}
export function readSessionOrder() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 512 * 1024) return defaults;
    return Saved.parse(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

/** 只保存排序方式和会话身份，不写原生历史，也不保存会话正文。 */
export const useSessionOrder = create<
  z.infer<typeof Saved> & {
    known: Record<string, string[]>;
    remember(project: string, ids: string[], filtered: boolean): void;
    setMode(mode: SessionSortMode): void;
    move(project: string, source: string, target: string, visible: string[]): void;
  }
>((set, get) => {
  const save = (next: z.infer<typeof Saved>) => {
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 当前页面仍可排序。 */
    }
  };
  return {
    ...readSessionOrder(),
    known: {},
    remember(project, ids, filtered) {
      const previous = get().known[project] ?? [];
      const next = filtered ? mergeCurrentOrder(previous, ids) : ids;
      if (JSON.stringify(previous) !== JSON.stringify(next)) set({ known: { ...get().known, [project]: next } });
    },
    setMode: (mode) => save({ mode, orders: get().orders }),
    move(project, source, target, visible) {
      if (source === target || !visible.includes(source) || !visible.includes(target)) return;
      const { mode, orders, known } = get();
      const previous = orders[project] ?? [];
      const remembered = known[project] ?? [];
      const complete =
        mode === 'manual' ? [...new Set([...previous, ...remembered])] : mergeCurrentOrder(previous, remembered);
      // 首次拖动以当前显示为准，搜索结果只校正相关身份。
      const base = mergeCurrentOrder(complete, visible);
      const order = base.filter((id) => id !== source);
      const afterTarget = visible.indexOf(source) < visible.indexOf(target);
      order.splice(order.indexOf(target) + (afterTarget ? 1 : 0), 0, source);
      save({ mode: 'manual', orders: { ...orders, [project]: order.slice(0, 2000) } });
    },
  };
});
