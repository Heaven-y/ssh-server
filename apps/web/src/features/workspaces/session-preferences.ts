import { create } from 'zustand';
import { z } from 'zod';
import { AgentKindSchema, NativeSessionIdSchema, type SessionRef } from '@ssh-server/shared';
import { sessionActionKey } from '../chat/chat-store';

export const SESSION_PINS_KEY = 'ssh-server.session-pins.v1';
const LIMIT = 1000;
const PinSchema = z.tuple([NativeSessionIdSchema, AgentKindSchema, NativeSessionIdSchema]);
const StorageSchema = z.object({ version: z.literal(1), pins: z.array(z.unknown()).max(LIMIT) }).strict();
function validPin(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 512) return [];
  try {
    const result = PinSchema.safeParse(JSON.parse(value));
    return result.success ? [JSON.stringify(result.data)] : [];
  } catch {
    return [];
  }
}

export function readSessionPins(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_PINS_KEY);
    if (!raw || raw.length > 512 * 1024) return [];
    const stored = StorageSchema.safeParse(JSON.parse(raw));
    return stored.success ? [...new Set(stored.data.pins.flatMap(validPin))] : [];
  } catch {
    return [];
  }
}
function save(pins: string[]): void {
  try {
    localStorage.setItem(SESSION_PINS_KEY, JSON.stringify({ version: 1, pins }));
  } catch {
    // 存储不可用时仍可在本页排序，不影响任何原生记录。
  }
}

/** 只存网页排序标识，不存标题、历史或模型覆盖；最多保留最近 1000 项。 */
export const useSessionPins = create<{
  pins: string[];
  toggle(workspaceId: string, session: SessionRef): void;
}>()((set, get) => ({
  pins: readSessionPins(),
  toggle(workspaceId, session) {
    const key = sessionActionKey(workspaceId, session);
    if (!validPin(key).length) return;
    const current = get().pins;
    const pins = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key].slice(-LIMIT);
    set({ pins });
    save(pins);
  },
}));
