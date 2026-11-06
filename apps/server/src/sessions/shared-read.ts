/** 一次底层读取可以有多个订阅者；只有全部离开才取消。 */
export function createSharedRead<T>(load: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let users = 0;
  let done = false;
  const pending = Promise.resolve()
    .then(() => {
      controller.signal.throwIfAborted();
      return load(controller.signal);
    })
    .finally(() => {
      done = true;
    });
  return {
    controller,
    pending,
    subscribe(signal?: AbortSignal): Promise<T> {
      users++;
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = () => {
          if (finished) return false;
          finished = true;
          signal?.removeEventListener('abort', abort);
          if (--users === 0 && !done) controller.abort();
          return true;
        };
        const abort = () => {
          if (finish()) reject(new Error('会话读取已取消'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        pending.then(
          (rows) => {
            if (finish()) resolve(rows);
          },
          (error: unknown) => {
            if (finish()) reject(error instanceof Error ? error : new Error('原生会话读取失败'));
          },
        );
      });
    },
  };
}
