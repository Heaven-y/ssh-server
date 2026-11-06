import { lazy } from 'react';
import { SquareTerminal } from 'lucide-react';
import type { BuiltinPluginRegistration } from '../../features/plugins/builtin-contracts';
import { closeTerminalTab, useTerminalStore } from './legacy/terminal/terminal-store';
export const sshConsoleRegistration: BuiltinPluginRegistration = {
  id: 'ssh-console',
  Page: lazy(() => import('./Workspace')),
  Icon: SquareTerminal,
  priority: 100,
  disableConfirmation: (plugin) =>
    `停用“${plugin.manifest.name}”将关闭它的页面与资源，包括项目服务器工具中的终端。服务器档案、项目和任务记录保留。继续吗？`,
  onDisabled() {
    // 后端停用成功才清除页面状态，避免重新启用时由旧标签创建 shell。
    for (const tab of useTerminalStore.getState().tabs) closeTerminalTab(tab.id);
  },
};
