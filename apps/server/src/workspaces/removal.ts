import { createHash } from 'node:crypto';
import type {
  Workspace,
  WorkspaceRemovalBlocker,
  WorkspaceRemovalInput,
  WorkspaceRemovalPreview,
  WorkspaceRemovalResult,
} from '@ssh-server/shared';
import type { WorkspaceStore } from './store';
import { WorkspaceRemovalError, type WorkspaceActivity } from './activity';

const signature = (workspace: Workspace) => createHash('sha256').update(JSON.stringify(workspace)).digest('hex');
type Deps = {
  store: WorkspaceStore;
  activity: WorkspaceActivity;
  blockers(id: string): Promise<WorkspaceRemovalBlocker[]>;
  close(id: string): void | Promise<void>;
};
export function createWorkspaceRemoval(deps: Deps) {
  const assertIdle = async (id: string) => {
    const blockers = await deps.blockers(id);
    if (blockers.length)
      throw new WorkspaceRemovalError('workspace_busy', blockers.map((item) => item.message).join('；'));
  };
  return {
    async preview(id: string): Promise<WorkspaceRemovalPreview> {
      const release = deps.activity.acquire(id);
      try {
        const workspace = await deps.store.get(id);
        if (!workspace) throw new WorkspaceRemovalError('workspace_missing', '工作区不存在');
        const blockers = await deps.blockers(id);
        if (deps.activity.active(id) > 1)
          blockers.unshift({ code: 'workspace_busy', message: '工作区仍有活动请求或对话，请结束后重试' });
        return { workspace, configuration: signature(workspace), blockers };
      } finally {
        release();
      }
    },
    remove(id: string, input: WorkspaceRemovalInput): Promise<WorkspaceRemovalResult> {
      return deps.activity.exclusive(id, async () => {
        await assertIdle(id);
        let removed: boolean;
        try {
          removed = await deps.store.remove(id, async (current) => {
            if (!input.confirmed || signature(current) !== input.configuration)
              throw new WorkspaceRemovalError('workspace_changed', '工作区配置已变化，请重新读取并核对');
            await assertIdle(id);
          });
        } catch (error) {
          if (error instanceof WorkspaceRemovalError) throw error;
          throw new WorkspaceRemovalError('workspace_remove_failed', '配置未能移除，请检查本机配置目录后重试');
        }
        if (!removed) throw new WorkspaceRemovalError('workspace_missing', '工作区不存在');
        try {
          await deps.close(id);
        } catch {
          return { removed: true, cleanupWarning: '配置已移除，但部分通道收尾未完成，请关闭对应面板并刷新' };
        }
        return { removed: true };
      });
    },
  };
}
export type WorkspaceRemoval = ReturnType<typeof createWorkspaceRemoval>;
