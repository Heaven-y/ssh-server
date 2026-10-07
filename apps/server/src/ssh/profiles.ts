import type { ManagedServer, Workspace, WorkspaceRemovalBlocker } from '@ssh-server/shared';
import type { WorkspaceStore } from '../workspaces/store';
import { WorkspaceRemovalError, type WorkspaceActivity } from '../workspaces/activity';
import type { SshPool } from './pool';
import { ServerTargetsError, serverDestination, type ServerTargets } from './targets';

type Deps = {
  targets: ServerTargets;
  store: Pick<WorkspaceStore, 'withSnapshot'>;
  activity: WorkspaceActivity;
  resources: { blockers(id: string): Promise<WorkspaceRemovalBlocker[]> };
  pool: Pick<SshPool, 'disconnect' | 'forgetServerCredentials'>;
};
/** 工作区快照→活动排他→档案写队列；任何回调都不重新取得前面的锁。 */
export function createServerProfiles(deps: Deps) {
  async function assertIdle(workspaces: readonly Workspace[]) {
    for (const workspace of workspaces) {
      if (deps.activity.active(workspace.id) || (await deps.resources.blockers(workspace.id)).length)
        throw new ServerTargetsError('target_busy');
    }
  }
  function exclusive<T>(workspaces: readonly Workspace[], operation: () => Promise<T>): Promise<T> {
    const enter = (index: number): Promise<T> => {
      const workspace = workspaces[index];
      return workspace ? deps.activity.exclusive(workspace.id, () => enter(index + 1)) : operation();
    };
    return enter(0).catch((error: unknown) => {
      if (error instanceof WorkspaceRemovalError) throw new ServerTargetsError('target_busy');
      throw error;
    });
  }
  function withServer<T>(alias: string, operation: (workspaces: readonly Workspace[]) => Promise<T>) {
    return deps.store.withSnapshot((all) => operation(all.filter((workspace) => workspace.sshHost === alias)));
  }
  return {
    list: deps.targets.list,
    save: deps.targets.save,
    importOptions: () => deps.targets.importOptions(),
    update(alias: string, input: unknown, expected: ManagedServer) {
      return withServer(alias, (workspaces) =>
        exclusive(workspaces, async () => {
          await assertIdle(workspaces);
          const next = await deps.targets.update(alias, input, expected, async (current, next) => {
            if (workspaces.length && serverDestination(current) !== serverDestination(next!))
              throw new ServerTargetsError('target_referenced');
            await assertIdle(workspaces);
            // 写盘前同步失效，阻止旧请求跨过提交点；写盘失败也要求重新连接。
            deps.pool.disconnect(alias);
          });
          return next;
        }),
      );
    },
    remove(alias: string, expected: ManagedServer) {
      return withServer(alias, (workspaces) =>
        exclusive(workspaces, async () => {
          if (workspaces.length) throw new ServerTargetsError('target_referenced');
          await deps.targets.remove(alias, expected, (current) => deps.pool.forgetServerCredentials(current));
        }),
      );
    },
    /** 认证/断开期间锁住受影响工作区；普通连接测试只复用连接，不终止它。 */
    connection<T>(alias: string, changing: boolean, operation: () => Promise<T>) {
      return withServer(alias, async (workspaces) => {
        if (!(await deps.targets.get(alias))) throw new ServerTargetsError('target_missing');
        if (!changing) return operation();
        return exclusive(workspaces, async () => {
          await assertIdle(workspaces);
          return operation();
        });
      });
    },
  };
}
export type ServerProfiles = ReturnType<typeof createServerProfiles>;
