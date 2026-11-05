import { randomUUID } from 'node:crypto';
import type { AgentTurnInput, TurnHandle, TurnRunner } from './types';

type Entry = { key: string; native: TurnRunner; timer?: NodeJS.Timeout };
type Deps = { environment(): Promise<NodeJS.ProcessEnv>; create(env: NodeJS.ProcessEnv): TurnRunner; idleMs?: number };
const keyOf = (input: AgentTurnInput) => JSON.stringify([input.workspace.id, input.workspace.dir, input.sessionId]);

/** 每个会话的进程保留启动快照；显式重启只回收空闲实例，不向 CLI 发送任何消息。 */
export function createConfiguredRunner(deps: Deps): TurnRunner & { restart(): Promise<void> } {
  const entries = new Map<string, Entry>();
  const handles = new Set<TurnHandle>();
  let preparing = 0;
  let restarting = false;
  let disposed = false;
  async function drop(entry: Entry) {
    clearTimeout(entry.timer);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    await entry.native.dispose?.();
  }
  function retain(entry: Entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void drop(entry).catch(() => undefined);
    }, deps.idleMs ?? 300_000);
    entry.timer.unref();
  }
  async function entryFor(input: AgentTurnInput, cancelled: () => boolean) {
    const key = input.sessionId ? keyOf(input) : randomUUID();
    const existing = entries.get(key);
    if (existing) return existing;
    if (entries.size >= 32) throw new Error();
    const env = await deps.environment();
    // 环境解析期间其他会话可能先占满实例；分配前须再次核对上限。
    if (cancelled() || disposed || entries.size >= 32) throw new Error();
    const entry = { key, native: deps.create(env) };
    entries.set(key, entry);
    return entry;
  }
  const runner = ((input: AgentTurnInput): TurnHandle => {
    let cancelled = false;
    let nativeHandle: TurnHandle | undefined;
    preparing++;
    async function start() {
      let entry: Entry | undefined;
      try {
        if (disposed || restarting) throw new Error();
        entry = await entryFor(input, () => cancelled);
        if (cancelled || disposed) throw new Error();
        clearTimeout(entry.timer);
        const current = entry;
        nativeHandle = current.native({
          ...input,
          emit: (event) => {
            if (event.type === 'session') {
              const learned = keyOf({ ...input, sessionId: event.sessionId });
              if (learned !== current.key && !entries.has(learned)) {
                entries.delete(current.key);
                current.key = learned;
                entries.set(learned, current);
              }
            }
            input.emit(event);
          },
        });
        await nativeHandle.done;
      } catch {
        input.emit({
          type: 'error',
          message: cancelled ? '本轮已中断。' : '无法准备 CLI 启动环境，请核对配置或重新启动。',
        });
        input.emit({ type: 'turn_end', isError: true });
      } finally {
        preparing--;
        if (entry && !disposed) retain(entry);
      }
    }
    const pending = start();
    const handle: TurnHandle = {
      interrupt: async () => {
        cancelled = true;
        await nativeHandle?.interrupt();
        await pending;
      },
      done: pending.finally(() => handles.delete(handle)),
    };
    handles.add(handle);
    return handle;
  }) as TurnRunner & { restart(): Promise<void> };
  runner.restart = async () => {
    if (preparing || restarting || disposed) throw new Error('CLI 正忙');
    restarting = true;
    try {
      await Promise.all([...entries.values()].map(drop));
    } finally {
      restarting = false;
    }
  };
  runner.dispose = async () => {
    disposed = true;
    // 中断可能要等真实进程 close；清理必须同时到达原生 dispose 的有界退出逻辑。
    for (const handle of handles) void handle.interrupt().catch(() => undefined);
    await Promise.all([...entries.values()].map(drop));
  };
  return runner;
}
