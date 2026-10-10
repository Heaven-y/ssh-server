import { Menu, MenuButton, MenuItem, useMenuStore } from '@ariakit/react';
import { Archive, ArchiveRestore, GitFork, Link, MoreHorizontal, Pencil, Pin, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import type { SessionActionInput, SessionSummary } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { AGENT_LABELS } from '../chat/AgentControls';

export type SessionDialogAction = SessionActionInput['action'] | 'fork';
export type SessionMenuAction = SessionDialogAction | 'pin' | 'copy';
const actions = {
  rename: { label: '重命名', icon: Pencil },
  pin: { label: '置顶', icon: Pin },
  copy: { label: '复制会话链接', icon: Link },
  fork: { label: '分叉会话', icon: GitFork },
  delete: { label: '删除', icon: Trash2 },
  archive: { label: '归档', icon: Archive },
  unarchive: { label: '恢复', icon: ArchiveRestore },
};

/** 菜单仅选动作；危险操作在后续确认视图中执行。 */
export function SessionMenu({
  session,
  archived,
  pinned,
  disabled,
  choose,
}: {
  session: SessionSummary;
  archived: boolean;
  pinned: boolean;
  disabled: boolean;
  choose(action: SessionMenuAction): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useMenuStore({ placement: 'bottom-start' });
  const visible: SessionMenuAction[] = [];
  if (!archived) visible.push('rename', 'pin', 'copy', 'fork');
  if (session.agent === 'codex') visible.push(archived ? 'unarchive' : 'archive');
  visible.push('delete');
  return (
    <>
      <MenuButton
        ref={trigger}
        store={menu}
        render={<button type="button" />}
        className={`${buttonClass('ghost')} shrink-0 px-1.5`}
        aria-label={`${AGENT_LABELS[session.agent]} 会话“${session.summary || '无标题会话'}”的更多操作`}
        title={disabled ? '会话运行或操作中，结束后可管理' : '更多会话操作'}
        disabled={disabled}
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </MenuButton>
      <Menu
        store={menu}
        portal
        unmountOnHide
        gutter={6}
        aria-label="会话操作"
        className="z-50 min-w-40 rounded-xl border border-border-strong bg-card p-1.5 text-foreground shadow-xl"
      >
        {visible.map((action) => {
          const Icon = actions[action].icon;
          return (
            <MenuItem
              key={action}
              disabled={disabled}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-active-item:bg-muted data-active-item:ring-1 data-active-item:ring-accent ${action === 'delete' ? 'text-destructive-foreground' : ''}`}
              onClick={() => {
                menu.hide();
                // 对话框关闭后回到仍存在的更多按钮，而不是即将卸载的菜单项。
                trigger.current?.focus();
                choose(action);
              }}
            >
              <Icon aria-hidden className="size-4" />
              {action === 'pin' && pinned ? '取消置顶' : actions[action].label}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
