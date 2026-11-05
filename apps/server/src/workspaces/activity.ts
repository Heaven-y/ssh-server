/**
 * 工作区租约：同步取得，计数覆盖异步等待，不依赖当前网页是否仍打开。
 * 管理操作与对话、文件任务共用原子边界，避免换目录时新回合进入旧身份。
 */
export class WorkspaceBusyError extends Error {
  constructor() {
    super('项目正在运行或处理其他操作，请结束后再更换目录或移除。');
  }
}
export function createWorkspaceActivity() {
  const counts = new Map<string, number>();
  const managing = new Set<string>();
  return {
    acquire(id: string) {
      if (managing.has(id)) throw new WorkspaceBusyError();
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
    async withIdle<T>(id: string, operation: () => Promise<T>): Promise<T> {
      if (counts.has(id) || managing.has(id)) throw new WorkspaceBusyError();
      managing.add(id);
      try {
        return await operation();
      } finally {
        managing.delete(id);
      }
    },
  };
}
export type WorkspaceActivity = ReturnType<typeof createWorkspaceActivity>;
