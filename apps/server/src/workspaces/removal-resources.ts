import type { WorkspaceRemovalBlocker } from '@ssh-server/shared';
import type { FileEditors } from '../files/editors';
import type { RemoteFilesService } from '../remote-files/service';
import type { FilePreflights } from '../remote-files/preflight';
import type { FileTasks } from '../remote-files/tasks';
import type { SyncManager } from '../sync/manager';
import type { TerminalManager } from '../terminal/manager';

export function createWorkspaceRemovalResources(deps: {
  editors: Pick<FileEditors, 'hasWorkspace'>;
  browse: Pick<RemoteFilesService, 'closeWorkspace'>;
  preflights: Pick<FilePreflights, 'closeWorkspace'>;
  tasks: Pick<FileTasks, 'blockers'>;
  sync: Pick<SyncManager, 'busy' | 'hasRemoteTask' | 'forget'>;
  terminals: Pick<TerminalManager, 'closeWorkspace'>;
}) {
  return {
    async blockers(id: string): Promise<WorkspaceRemovalBlocker[]> {
      const [editors, remoteTask, tasks] = await Promise.all([
        deps.editors.hasWorkspace(id),
        deps.sync.hasRemoteTask(id),
        deps.tasks.blockers(id),
      ]);
      const result = [...tasks];
      if (deps.sync.busy(id)) result.push({ code: 'sync_busy', message: '同步或初始化仍在运行，请等待收尾' });
      if (remoteTask) result.push({ code: 'sync_task_pending', message: '仍有服务器文件任务阻断同步，请先核对或恢复' });
      if (editors)
        result.push({ code: 'editors_registered', message: '仍有编辑器登记，请先关闭编辑器或处理已断开页面的缓冲' });
      return result;
    },
    async close(id: string) {
      // 每项都尝试清理；失败只影响通道收尾结果，不撤销已经保存的配置移除。
      const results = await Promise.allSettled([
        Promise.resolve().then(() => deps.terminals.closeWorkspace(id)),
        Promise.resolve().then(() => deps.browse.closeWorkspace(id)),
        Promise.resolve().then(() => deps.preflights.closeWorkspace(id)),
        Promise.resolve().then(() => deps.sync.forget(id)),
      ]);
      const errors = results.filter((result) => result.status === 'rejected').map((result): unknown => result.reason);
      if (errors.length) throw new AggregateError(errors, '工作区通道收尾未全部完成');
    },
  };
}
