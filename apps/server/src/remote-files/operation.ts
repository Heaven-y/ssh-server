import { RemoteFilesError } from './errors';

/** 截止时间覆盖排队、配置读取与 SSH 握手；迟到资源由操作自身按 signal 清理。 */
export async function remoteOperation<T>(
  parent: AbortSignal | undefined,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(parent?.reason instanceof RemoteFilesError ? parent.reason : new RemoteFilesError('cancelled'));
  const timer = setTimeout(() => controller.abort(new RemoteFilesError('timeout')), 30_000);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  let rejectAbort: () => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason as Error);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  try {
    return await Promise.race([
      stopped,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return action(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
