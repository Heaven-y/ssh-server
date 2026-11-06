/** 等待者取消只结束自己的等待；底层任务的取消由所有者决定。 */
export async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let rejectAbort!: (reason: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancelled = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', cancelled, { once: true });
  if (signal.aborted) cancelled();
  try {
    return await Promise.race([pending, stopped]);
  } finally {
    signal.removeEventListener('abort', cancelled);
  }
}
