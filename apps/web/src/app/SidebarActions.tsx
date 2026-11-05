import { Menu, MenuButton, MenuItem, useMenuStore } from '@ariakit/react';
import { Check, Command, Ellipsis, SquarePen } from 'lucide-react';
import type { AgentKind, Workspace } from '@agentdeck/shared';
import { AGENT_LABELS } from '../features/chat/AgentControls';
import { AgentIcon } from '../ui/BrandIcons';

const AGENT_ORDER: AgentKind[] = ['claude', 'codex', 'antigravity'];
export const sidebarMenuClass = 'z-50 min-w-48 rounded-xl border border-border bg-card p-1 text-foreground shadow-lg';
export const sidebarMenuItemClass =
  'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent';
export const sidebarItemClass = (collapsed: boolean) =>
  `flex min-h-9 w-full min-w-0 items-center gap-3 rounded-lg text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${collapsed ? 'justify-center px-0' : 'px-3'}`;

export function NewSessionMenu({
  projects,
  currentProjectId,
  collapsed,
  onNewSession,
  onAddProject,
}: {
  projects: Workspace[];
  currentProjectId?: string;
  collapsed: boolean;
  onNewSession?(projectId: string, agent: AgentKind): void;
  onAddProject(): void;
}) {
  const menu = useMenuStore({ placement: collapsed ? 'right-start' : 'bottom-start' });
  const target = projects.find((project) => project.id === currentProjectId) ?? projects[0];
  const content = (
    <>
      <SquarePen aria-hidden className="size-4 shrink-0" />
      {!collapsed && <span>新建会话</span>}
    </>
  );
  if (!target)
    return (
      <button
        type="button"
        aria-label="新建会话"
        title="添加项目并新建会话"
        className={sidebarItemClass(collapsed)}
        onClick={onAddProject}
      >
        {content}
      </button>
    );
  return (
    <>
      <MenuButton
        store={menu}
        render={<button type="button" />}
        className={sidebarItemClass(collapsed)}
        aria-label="新建会话"
        title="新建会话"
      >
        {content}
      </MenuButton>
      <Menu store={menu} portal unmountOnHide gutter={6} aria-label="选择 CLI" className={sidebarMenuClass}>
        <p className="max-w-64 truncate px-3 py-1.5 text-xs text-muted-foreground">在 {target.name} 新建</p>
        {AGENT_ORDER.map((agent) => (
          <MenuItem
            key={agent}
            className={sidebarMenuItemClass}
            onClick={() => {
              menu.hide();
              onNewSession?.(target.id, agent);
            }}
          >
            <AgentIcon agent={agent} />
            {AGENT_LABELS[agent]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function SidebarMore({
  collapsed,
  showOtherSessions,
  setShowOtherSessions,
  onOpenCommands,
}: {
  collapsed: boolean;
  showOtherSessions: boolean;
  setShowOtherSessions(show: boolean): void;
  onOpenCommands?(): void;
}) {
  const menu = useMenuStore({ placement: collapsed ? 'right-start' : 'bottom-start' });
  return (
    <>
      <MenuButton
        store={menu}
        render={<button type="button" />}
        aria-label="更多"
        title="更多"
        className={sidebarItemClass(collapsed)}
      >
        <Ellipsis aria-hidden className="size-4 shrink-0" />
        {!collapsed && <span>更多</span>}
      </MenuButton>
      <Menu store={menu} portal unmountOnHide gutter={6} aria-label="更多导航" className={sidebarMenuClass}>
        {onOpenCommands && (
          <MenuItem
            className={sidebarMenuItemClass}
            onClick={() => {
              menu.hide();
              onOpenCommands();
            }}
          >
            <Command aria-hidden className="size-4" />
            命令面板
          </MenuItem>
        )}
        <MenuItem
          role="menuitemcheckbox"
          aria-checked={showOtherSessions}
          className={sidebarMenuItemClass}
          onClick={() => {
            setShowOtherSessions(!showOtherSessions);
            menu.hide();
          }}
        >
          <Check aria-hidden className={`size-4 ${showOtherSessions ? '' : 'invisible'}`} />
          显示其他目录的会话
        </MenuItem>
      </Menu>
    </>
  );
}
