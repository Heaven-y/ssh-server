import type { RcloneContext } from './rclone';

/** 仅关闭本次同步拥有的传输上下文，不影响同一 SSH 连接的其他活动。 */
export function bindSyncCancellation(context: Pick<RcloneContext, 'close'>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const cancel = () => context.close();
  signal?.addEventListener('abort', cancel, { once: true });
  return () => signal?.removeEventListener('abort', cancel);
}
