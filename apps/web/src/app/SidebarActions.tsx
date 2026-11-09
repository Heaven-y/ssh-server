import { sidebarMenuClass, sidebarMenuItemClass, sidebarItemClass } from '../ui/sidebar-styles';
import { Menu, MenuButton, MenuItem, useMenuStore } from '@ariakit/react';
import { Archive, Check, Command, Ellipsis, Plus, SquarePen } from 'lucide-react';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { Workspace } from '@agentdeck/shared/projects';
import { AGENT_LABELS } from '../cli/shared/labels';
import { AgentIcon } from '../ui/BrandIcons';

const AGENT_ORDER: AgentKind[] = ['claude', 'codex', 'antigravity'];
function NewSessionContent({ compact, collapsed }: { compact: boolean; collapsed: boolean }) {
  const Icon = compact ? Plus : SquarePen;
  return (
    <>
      <Icon aria-hidden className="size-4 shrink-0" />
      {!collapsed && !compact && <span>新建会话</span>}
    </>
  );
}
export function NewSessionMenu({
  projects,
  currentProjectId,
  collapsed,
  compact = false,
  onNewSession,
  onAddProject,
}: {
  projects: Workspace[];
  currentProjectId?: string;
  collapsed: boolean;
  compact?: boolean;
  onNewSession?(projectId: string, agent: AgentKind): void;
  onAddProject(): void;
}) {
  const menu = useMenuStore({ placement: collapsed ? 'right-start' : 'bottom-start' });
  const target = projects.find((project) => project.id === currentProjectId) ?? projects[0];
  const label = compact && target ? `在“${target.name}”新建会话` : '新建会话';
  const content = <NewSessionContent compact={compact} collapsed={collapsed} />;
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
        className={
          compact
            ? 'flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent'
            : sidebarItemClass(collapsed)
        }
        aria-label={label}
        title={label}
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
  onOpenArchive,
}: {
  collapsed: boolean;
  showOtherSessions: boolean;
  setShowOtherSessions(show: boolean): void;
  onOpenCommands?(): void;
  onOpenArchive?(): void;
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
      <Menu store={menu} portal fixed unmountOnHide gutter={6} aria-label="更多导航" className={sidebarMenuClass}>
        {onOpenArchive && (
          <MenuItem
            className={sidebarMenuItemClass}
            onClick={() => {
              menu.hide();
              onOpenArchive();
            }}
          >
            <Archive aria-hidden className="size-4" />
            已归档会话
          </MenuItem>
        )}
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
