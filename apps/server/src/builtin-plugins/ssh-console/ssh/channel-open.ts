/** 取消先于 SSH 回调时立即拒绝；迟到通道仍需释放。 */
export function openGuardedSshChannel<T>(
  invoke: (done: (error: Error | undefined, channel: T) => void) => void,
  options: { signal: AbortSignal; current(): boolean; release(channel: T): void },
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cancelled = () => {
      finished = true;
      options.signal.removeEventListener('abort', cancelled);
      reject(options.signal.reason instanceof Error ? options.signal.reason : new Error('SSH 通道已取消'));
    };
    options.signal.addEventListener('abort', cancelled, { once: true });
    if (options.signal.aborted) cancelled();
    if (finished) return;
    const done = (error: Error | undefined, channel: T) => {
      options.signal.removeEventListener('abort', cancelled);
      if (finished) {
        if (channel) options.release(channel);
        return;
      }
      finished = true;
      if (error) return reject(error);
      if (!options.current()) {
        options.release(channel);
        reject(new Error('SSH 认证或通道身份已变化'));
      } else resolve(channel);
    };
    try {
      invoke(done);
    } catch (error) {
      options.signal.removeEventListener('abort', cancelled);
      finished = true;
      reject(error instanceof Error ? error : new Error('SSH 通道无法开启'));
    }
  });
}
