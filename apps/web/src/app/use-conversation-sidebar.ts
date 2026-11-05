import { useState } from 'react';
import { useMinWidth } from './use-min-width';
import { useUiPreferences } from '../ui/ui-preferences';

/** 每次启动默认关闭；旧服务器栏的持久展开偏好不再决定对话界面。 */
export function useConversationSidebar() {
  const [open, setOpen] = useState(false);
  const wide = useMinWidth(1024);
  const collapsed = useUiPreferences((state) => state.sidebarCollapsed || state.sidebarAutoCollapsed);
  const visible = open && (wide || collapsed);
  return {
    open: visible,
    hide: () => setOpen(false),
    toggle: () => {
      if (!visible && !wide) useUiPreferences.getState().setSidebarAutoCollapsed(true);
      setOpen(!visible);
    },
  };
}
