export class WorkspaceRemovalError extends Error {
  constructor(
    readonly code:
      'workspace_busy' | 'workspace_deleting' | 'workspace_missing' | 'workspace_changed' | 'workspace_remove_failed',
    message: string,
  ) {
    super(message);
  }
  get status() {
    return this.code === 'workspace_missing' ? 404 : this.code === 'workspace_remove_failed' ? 503 : 409;
  }
}

/** 同步取得租约或关闭入口；计数覆盖异步等待，不依赖当前网页是否仍打开。 */
export function createWorkspaceActivity() {
  const counts = new Map<string, number>();
  const closing = new Set<string>();
  const assertOpen = (id: string) => {
    if (closing.has(id)) throw new WorkspaceRemovalError('workspace_deleting', '工作区正在移除，请稍后刷新');
  };
  return {
    assertOpen,
    acquire(id: string) {
      assertOpen(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = (counts.get(id) ?? 1) - 1;
        if (next > 0) counts.set(id, next);
        else counts.delete(id);
      };
    },
    async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
      assertOpen(id);
      closing.add(id);
      try {
        if (counts.has(id)) throw new WorkspaceRemovalError('workspace_busy', '工作区仍有活动请求或对话，请结束后重试');
        return await operation();
      } finally {
        closing.delete(id);
      }
    },
  };
}
export type WorkspaceActivity = ReturnType<typeof createWorkspaceActivity>;
