import { isBoundWorkspace, type BoundWorkspace, type Workspace } from '@agentdeck/shared';

/**
 * 服务器面板只服务「已绑定服务器与默认目录」的项目。
 * 未绑定时不在这里抛错：各域按自己的错误码拒绝（终端 target_changed、远端文件 workspace_missing 等）。
 */
export const boundWorkspace = (workspace: Workspace | undefined): BoundWorkspace | undefined =>
  workspace && isBoundWorkspace(workspace) ? workspace : undefined;
