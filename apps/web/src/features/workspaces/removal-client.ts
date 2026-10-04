import type { QueryClient } from '@tanstack/react-query';
import type { Workspace } from '@ssh-server/shared';
import { queryKeys } from '../../lib/api';
import { useChat } from '../chat/chat-store';
import { closeWorkspaceTerminals } from '../terminal/terminal-store';

const workspaceQueries = new Set([
  'sessions',
  'sync',
  'versions',
  'files',
  'agent-capabilities',
  'disconnected-editors',
  'resources',
  'workspace-removal',
]);
/** 收尾不依赖弹窗是否仍挂载；查询取消失败不能把已移除配置回显为删除失败。 */
export async function finishWorkspaceRemoval(client: QueryClient, id: string) {
  await client.cancelQueries({ queryKey: queryKeys.workspaces }).catch(() => undefined);
  const list = (client.getQueryData<Workspace[]>(queryKeys.workspaces) ?? []).filter(
    (workspace) => workspace.id !== id,
  );
  client.setQueryData(queryKeys.workspaces, list);
  useChat.getState().removeWorkspace(id, list[0]?.id);
  closeWorkspaceTerminals(id);
  const filter = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      typeof query.queryKey[0] === 'string' && workspaceQueries.has(query.queryKey[0]) && query.queryKey[1] === id,
  };
  await client.cancelQueries(filter).catch(() => undefined);
  client.removeQueries(filter);
  void client.invalidateQueries({ queryKey: queryKeys.workspaces }).catch(() => undefined);
}
