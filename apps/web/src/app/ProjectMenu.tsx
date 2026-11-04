import { Menu, MenuButton, MenuItem, useMenuStore } from '@ariakit/react';
import { FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import type { Workspace } from '@agentdeck/shared';
import { buttonClass } from '../ui/styles';
import { useProjectChatBusy, type ProjectManageAction } from './project-management';

const actions = [
  { action: 'rename', label: '重命名项目', Icon: Pencil },
  { action: 'directory', label: '更换项目目录', Icon: FolderOpen },
  { action: 'remove', label: '移除项目', Icon: Trash2 },
] as const;
export function ProjectMenu({
  project,
  running,
  choose,
}: {
  project: Workspace;
  running: boolean;
  choose(action: ProjectManageAction): void;
}) {
  const busy = useProjectChatBusy(project.id);
  const disabled = busy || running;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useMenuStore({ placement: 'bottom-start' });
  return (
    <>
      <MenuButton
        store={menu}
        ref={trigger}
        render={<button type="button" />}
        disabled={disabled}
        aria-label={`管理项目“${project.name}”`}
        title={disabled ? '会话运行或操作中，结束后可管理项目' : '项目管理'}
        className={`${buttonClass('ghost')} shrink-0 px-1.5`}
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </MenuButton>
      <Menu
        store={menu}
        portal
        unmountOnHide
        gutter={6}
        aria-label="项目操作"
        className="z-50 min-w-40 rounded-xl border border-border-strong bg-card p-1.5 text-foreground shadow-xl"
      >
        {actions.map(({ action, label, Icon }) => (
          <MenuItem
            key={action}
            disabled={disabled}
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent ${action === 'remove' ? 'text-destructive-foreground' : ''}`}
            onClick={() => {
              menu.hide();
              trigger.current?.focus();
              choose(action);
            }}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
