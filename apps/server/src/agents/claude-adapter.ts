// Claude 适配器：同一会话复用长驻运行时，空闲超时后回收。
import type { TurnHandle, TurnRunner } from './types';
import { ClaudeRuntime, PERMISSION_TIMEOUT_MS, type ClaudeTurnInput } from './claude-runtime';

export { PERMISSION_TIMEOUT_MS };
export type { ClaudeTurnInput } from './claude-runtime';
export type { QueryFn } from './claude-query';
export type { PermissionAnswer, TurnHandle } from './types';

/** 没有新轮次时保留原生进程的时间；超过后关闭并释放令牌。 */
export const CLAUDE_IDLE_TIMEOUT_MS = 5 * 60_000;

/** 单轮调用：创建运行时、跑完即关闭，用于能力探测与一次性操作。 */
export function runClaudeTurn(input: ClaudeTurnInput): TurnHandle {
  const runtime = new ClaudeRuntime(input);
  const handle = runtime.run(input);
  return {
    interrupt: () => handle.interrupt(),
    done: handle.done.then(() => runtime.close()),
  };
}

type Entry = { runtime: ClaudeRuntime; key: string; timer?: NodeJS.Timeout };

/**
 * 按工作区、原生会话与模型配置复用运行时。
 * 模型或推理强度改变时创建新运行时，避免沿用旧进程的启动参数。
 */
export function createClaudeRunner(options: { idleMs?: number } = {}): TurnRunner {
  const idleMs = options.idleMs ?? CLAUDE_IDLE_TIMEOUT_MS;
  const runtimes = new Map<string, Entry>();
  const keyOf = (input: ClaudeTurnInput) =>
    JSON.stringify([
      input.workspace.id,
      input.workspace.localDir,
      input.workspace.sshHost,
      input.workspace.remoteDir,
      input.sessionId ?? '',
      input.model ?? '',
      input.reasoningEffort ?? '',
    ]);
  const drop = async (entry: Entry) => {
    clearTimeout(entry.timer);
    if (runtimes.get(entry.key) === entry) runtimes.delete(entry.key);
    await entry.runtime.close();
  };
  const schedule = (entry: Entry) => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void drop(entry), idleMs);
    entry.timer.unref?.();
  };
  const runner = ((input: ClaudeTurnInput): TurnHandle => {
    let entry = runtimes.get(keyOf(input));
    if (entry && !entry.runtime.alive) {
      void drop(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = { runtime: new ClaudeRuntime(input), key: keyOf(input) };
      runtimes.set(entry.key, entry);
    }
    clearTimeout(entry.timer);
    const current = entry;
    const handle = current.runtime.run(input);
    return {
      interrupt: () => handle.interrupt(),
      done: handle.done.then(async () => {
        if (!current.runtime.alive) {
          await drop(current);
          return;
        }
        // 新会话在首轮才拿到原生 id，收尾时改登记，后续轮次才能复用同一进程。
        const learned = keyOf({ ...input, sessionId: current.runtime.sessionId ?? input.sessionId });
        if (learned !== current.key && !runtimes.has(learned)) {
          runtimes.delete(current.key);
          current.key = learned;
          runtimes.set(learned, current);
        }
        schedule(current);
      }),
    };
  }) as TurnRunner;
  runner.dispose = async () => {
    const entries = [...runtimes.values()];
    runtimes.clear();
    await Promise.all(entries.map((entry) => drop(entry)));
  };
  return runner;
}
