import type { UseQueryResult } from '@tanstack/react-query';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Workspace } from '@ssh-server/shared';
import { DetailDialog } from '../../ui/DetailDialog';
import { buttonClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { SessionList } from './SessionList';
import { WorkspaceForm } from './WorkspaceForm';
import { WorkspaceRemoveDialog } from './WorkspaceRemoveDialog';

type Props = { workspaces: UseQueryResult<Workspace[]>; currentId?: string; onRemoved?(id: string): void };

/** 工作区导航保持紧凑；会话独立滚动，新建配置在模态中完成。 */
export function WorkspaceSidebar({ workspaces, currentId, onRemoved }: Props) {
  const selectWorkspace = useChat((s) => s.selectWorkspace);
  const [creating, setCreating] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [notice, setNotice] = useState('');
  const list = workspaces.data ?? [];
  const closeForm = () => {
    if (formBusy) return;
    setCreating(false);
  };

  return (
    <aside
      aria-label="工作区与会话"
      className="flex min-h-0 w-60 shrink-0 flex-col border-r border-border bg-card/70 xl:w-64"
    >
      <section aria-labelledby="ws-heading" className="flex shrink-0 flex-col gap-2 px-3 pb-4 pt-3">
        <div className="flex min-h-11 items-center justify-between gap-2 px-1">
          <h2 id="ws-heading" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            工作区
            {list.length > 0 && <span className="font-normal tabular-nums">{list.length}</span>}
          </h2>
          <button
            type="button"
            className={`${buttonClass('ghost')} px-2`}
            aria-expanded={creating}
            aria-haspopup="dialog"
            onClick={() => {
              setFormBusy(false);
              setCreating(true);
            }}
          >
            <Plus aria-hidden className="size-4" />
            新建
          </button>
        </div>

        {workspaces.isPending && <p className="px-3 py-3 text-sm text-muted-foreground">正在加载工作区…</p>}
        {workspaces.isError && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive-foreground"
          >
            {workspaces.error.message}
          </p>
        )}
        {workspaces.isSuccess && list.length === 0 && (
          <p className="px-3 py-3 text-sm leading-6 text-muted-foreground">新建工作区，关联本地项目与服务器。</p>
        )}

        <ul className="flex max-h-[32dvh] flex-col gap-1 overflow-y-auto p-1">
          {list.map((ws) => (
            <li key={ws.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-current={ws.id === currentId ? 'true' : undefined}
                title={ws.name}
                onClick={() => selectWorkspace(ws.id)}
                className="group flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground aria-[current]:border-accent/25 aria-[current]:bg-accent/10 aria-[current]:font-medium aria-[current]:text-foreground"
              >
                <FolderOpen aria-hidden className="size-4 shrink-0 group-aria-[current]:text-accent" />
                <span className="truncate">{ws.name}</span>
              </button>
              <button
                type="button"
                aria-label={`移除工作区：${ws.name}`}
                title={`移除工作区：${ws.name}`}
                className={`${buttonClass('ghost')} min-h-11 w-11 shrink-0 px-0`}
                onClick={() => {
                  setNotice('');
                  setRemoving(ws.id);
                }}
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <p role="status" className="px-2 text-xs leading-5 text-muted-foreground">
          {notice}
        </p>
      </section>

      {currentId && <SessionList workspaceId={currentId} />}
      {creating && (
        <DetailDialog title="新建工作区" onClose={closeForm} busy={formBusy}>
          <WorkspaceForm
            onBusyChange={setFormBusy}
            onCancel={closeForm}
            onCreated={(ws) => {
              setCreating(false);
              setFormBusy(false);
              selectWorkspace(ws.id);
            }}
          />
        </DetailDialog>
      )}
      {removing ? (
        <WorkspaceRemoveDialog
          key={removing}
          workspaceId={removing}
          onClose={() => setRemoving(undefined)}
          onRemoved={(id, result) => {
            setRemoving(undefined);
            setNotice(result.cleanupWarning ?? '工作区配置已移除，两端文件与历史已保留。');
            onRemoved?.(id);
          }}
        />
      ) : null}
    </aside>
  );
}
