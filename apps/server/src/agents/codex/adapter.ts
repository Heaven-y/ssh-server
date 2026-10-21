// Codex 适配器：同一原生会话复用 app-server 进程，空闲超时后回收。
import type { AgentTurnInput, TurnHandle, TurnRunner } from '../types';
import { CodexRuntime, CodexTurn } from './runtime';
import type { CodexRuntimeOptions } from './types';

export { CodexRuntime, CodexTurn } from './runtime';

/** 没有新轮次时保留 app-server 的时间；超过后关闭并释放令牌。 */
export const CODEX_IDLE_TIMEOUT_MS = 5 * 60_000;

function startTurn(runtime: CodexRuntime, input: AgentTurnInput): TurnHandle {
  const controller = new AbortController();
  const turn = new CodexTurn(runtime, input, controller.signal);
  runtime.current = turn;
  return {
    interrupt: () => turn.interrupt(),
    done: turn.run(),
  };
}

/** 单轮调用：创建会话、跑完即关闭，用于一次性操作与测试。 */
export function runCodexTurn(input: AgentTurnInput, options: CodexRuntimeOptions = {}): TurnHandle {
  const runtime = new CodexRuntime(input, options);
  const handle = startTurn(runtime, input);
  return { interrupt: () => handle.interrupt(), done: handle.done.then(() => runtime.close()) };
}

type Entry = { runtime: CodexRuntime; key: string; timer?: NodeJS.Timeout };

/**
 * 按工作区、原生会话与模型配置复用 app-server 进程。
 * 模型或推理强度改变时创建新会话，避免沿用旧线程的启动参数。
 */
export function createCodexRunner(options: CodexRuntimeOptions & { idleMs?: number } = {}): TurnRunner {
  const { idleMs = CODEX_IDLE_TIMEOUT_MS, ...launch } = options;
  const runtimes = new Map<string, Entry>();
  const keyOf = (input: AgentTurnInput) =>
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
  const runner = ((input: AgentTurnInput): TurnHandle => {
    let entry = runtimes.get(keyOf(input));
    if (entry && !entry.runtime.alive) {
      void drop(entry);
      entry = undefined;
    }
    if (!entry) {
      entry = { runtime: new CodexRuntime(input, launch), key: keyOf(input) };
      runtimes.set(entry.key, entry);
    }
    clearTimeout(entry.timer);
    const current = entry;
    const handle = startTurn(current.runtime, input);
    return {
      interrupt: () => handle.interrupt(),
      done: handle.done.then(async () => {
        if (!current.runtime.alive) {
          await drop(current);
          return;
        }
        // 新会话在首轮才拿到原生线程 id，收尾时改登记，后续轮次才能复用同一进程。
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
