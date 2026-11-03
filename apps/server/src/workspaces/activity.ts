/**
 * 工作区租约：同步取得，计数覆盖异步等待，不依赖当前网页是否仍打开。
 * 工作区移除链条已删除，这里只保留对话与文件任务共用的活动登记与释放。
 */
export function createWorkspaceActivity() {
  const counts = new Map<string, number>();
  return {
    acquire(id: string) {
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
  };
}
export type WorkspaceActivity = ReturnType<typeof createWorkspaceActivity>;
