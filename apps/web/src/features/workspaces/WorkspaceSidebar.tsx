import type { UseQueryResult } from '@tanstack/react-query';
import { FolderOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { SessionList } from './SessionList';
import { WorkspaceForm } from './WorkspaceForm';

type Props = { workspaces: UseQueryResult<Workspace[]>; currentId?: string };

/** 左侧栏：工作区列表、新建工作区表单、当前工作区的会话列表 */
export function WorkspaceSidebar({ workspaces, currentId }: Props) {
  const selectWorkspace = useChat((s) => s.selectWorkspace);
  const [creating, setCreating] = useState(false);
  const list = workspaces.data ?? [];

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-card p-3">
      <section aria-labelledby="ws-heading" className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 id="ws-heading" className="text-xs font-semibold text-muted-foreground">
            工作区
          </h2>
          <button
            type="button"
            className={buttonClass('ghost')}
            aria-expanded={creating}
            onClick={() => setCreating((v) => !v)}
          >
            <Plus aria-hidden className="size-4" />
            新建
          </button>
        </div>

        {creating && (
          <WorkspaceForm
            onCancel={() => setCreating(false)}
            onCreated={(ws) => {
              setCreating(false);
              selectWorkspace(ws.id);
            }}
          />
        )}

        {workspaces.isError && (
          <p role="alert" className="text-sm text-destructive-foreground">
            {workspaces.error.message}
          </p>
        )}
        {workspaces.isSuccess && list.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground">还没有工作区。点击"新建"，选择本地文件夹和服务器目录。</p>
        )}

        <ul className="flex flex-col gap-0.5">
          {list.map((ws) => (
            <li key={ws.id}>
              <button
                type="button"
                aria-current={ws.id === currentId ? 'true' : undefined}
                onClick={() => selectWorkspace(ws.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted aria-[current]:bg-muted aria-[current]:font-medium"
              >
                <FolderOpen aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{ws.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {currentId && <SessionList workspaceId={currentId} />}
    </aside>
  );
}
