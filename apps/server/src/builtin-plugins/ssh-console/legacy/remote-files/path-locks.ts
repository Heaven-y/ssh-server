import { inside } from './paths';

type Request = { identity: string; paths: string[]; grant(): void; signal: AbortSignal };
const overlaps = (left: Request, right: Request) =>
  left.identity === right.identity && left.paths.some((a) => right.paths.some((b) => inside(a, b) || inside(b, a)));

/** 同一实际 SSH 身份的相交路径排队；无关路径并行，不占用目录浏览锁。 */
export function createPathLocks(maxActive = 4) {
  const waiting: Request[] = [];
  const active = new Set<Request>();
  function schedule() {
    for (const request of [...waiting]) {
      if (active.size >= maxActive) return;
      const earlier = waiting.slice(0, waiting.indexOf(request));
      if ([...active, ...earlier].some((other) => overlaps(request, other))) continue;
      waiting.splice(waiting.indexOf(request), 1);
      active.add(request);
      request.grant();
    }
  }
  return {
    async run<T>(identity: string, paths: string[], signal: AbortSignal, action: () => Promise<T>): Promise<T> {
      signal.throwIfAborted();
      let request!: Request;
      let abort!: () => void;
      await new Promise<void>((resolve, reject) => {
        request = { identity, paths, signal, grant: resolve };
        abort = () => {
          const position = waiting.indexOf(request);
          if (position < 0) return;
          waiting.splice(position, 1);
          reject(signal.reason as Error);
          schedule();
        };
        signal.addEventListener('abort', abort, { once: true });
        waiting.push(request);
        schedule();
      });
      signal.removeEventListener('abort', abort);
      try {
        signal.throwIfAborted();
        return await action();
      } finally {
        active.delete(request);
        schedule();
      }
    },
  };
}
