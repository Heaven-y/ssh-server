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
export const sessionOrderKey = (session: SessionSummary) => JSON.stringify([session.agent, session.sessionId]);
const recentFirst = (a: SessionSummary, b: SessionSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

export function sortSessions(sessions: SessionSummary[], mode: SessionSortMode, order: string[] = []) {
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
      const next = filtered ? [...new Set([...previous, ...ids])] : ids;
      if (JSON.stringify(previous) !== JSON.stringify(next)) set({ known: { ...get().known, [project]: next } });
    },
    setMode: (mode) => save({ mode, orders: get().orders }),
    move(project, source, target, visible) {
      if (source === target || !visible.includes(source) || !visible.includes(target)) return;
      const previous = get().orders[project] ?? [];
      const known = get().known[project] ?? [];
      const base = [...new Set([...previous, ...known, ...visible])];
      // 在已加载列表上移动时保留尚未加载的记录位置。
      const order = base.filter((id) => id !== source);
      order.splice(base.indexOf(target), 0, source);
      save({ mode: 'manual', orders: { ...get().orders, [project]: order.slice(0, 2000) } });
    },
  };
});
