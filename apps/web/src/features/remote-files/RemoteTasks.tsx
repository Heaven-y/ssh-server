import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { RemoteFileTask, RemoteFileTaskPhase } from '@ssh-server/shared';
import { api } from '../../lib/api';
import { buttonClass } from '../../ui/styles';
import { ACTION_LABELS } from './RemoteActionDialog';
import { RemoteDialog } from './RemoteDialog';

const PHASE_LABELS: Record<RemoteFileTaskPhase, string> = {
  queued: '排队中',
  checking: '重新核对',
  creating: '新建中',
  renaming: '移动中',
  copying: '复制中',
  verifying: '核对副本',
  removing_source: '移除源',
  completed: '完成',
  cancelled: '已取消',
  failed: '未执行成功',
  needs_check: '结果待核对',
  sync_pending: '远端已完成，同步待恢复',
};
const ACTIVE = new Set<RemoteFileTaskPhase>([
  'queued',
  'checking',
  'creating',
  'renaming',
  'copying',
  'verifying',
  'removing_source',
]);
export const remoteTasksKey = (workspaceId: string) => ['remote-file-tasks', workspaceId] as const;
const canRecover = (task: RemoteFileTask) => task.syncRequired && !task.syncCompleted && !ACTIVE.has(task.phase);
const taskPaths = (task: RemoteFileTask) => `${task.source ?? '—'}${task.destination ? ` → ${task.destination}` : ''}`;

export function RemoteTasks({
  workspaceId,
  active,
  changed,
}: {
  workspaceId: string;
  active: boolean;
  changed(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: remoteTasksKey(workspaceId),
    queryFn: ({ signal }) => api.remoteFileTasks(workspaceId, signal),
    enabled: active,
    refetchInterval: (state) =>
      active && state.state.data?.tasks.some((task) => ACTIVE.has(task.phase)) ? 1500 : false,
    refetchIntervalInBackground: false,
  });
  const tasks = query.data?.tasks ?? [];
  const ongoing = tasks.filter(
    (task) => ACTIVE.has(task.phase) || ['needs_check', 'sync_pending'].includes(task.phase),
  ).length;
  return (
    <section
      aria-label="服务器文件任务"
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-border p-3"
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <button
          type="button"
          className={buttonClass('ghost')}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          文件任务 · {tasks.length}
          {ongoing ? `（${ongoing} 项待处理）` : ''}
        </button>
        <button
          type="button"
          className={buttonClass('ghost')}
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
            changed();
          }}
        >
          刷新结果
        </button>
      </div>
      {query.error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {query.error.message}
        </p>
      )}
      {expanded && (
        <div className="mt-2 max-h-64 min-h-0 space-y-2 overflow-auto">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              refresh={() => {
                void query.refetch();
                changed();
              }}
            />
          ))}
          {!tasks.length && (
            <p className="p-2 text-xs text-muted-foreground">暂无文件任务。提交后的操作独立运行，关闭面板不会取消。</p>
          )}
        </div>
      )}
    </section>
  );
}

function TaskRow({ task, refresh }: { task: RemoteFileTask; refresh(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovering, setRecovering] = useState(false);
  async function act(action: 'cancel' | 'check') {
    setBusy(true);
    setError('');
    try {
      await api.remoteFileTaskAction(task.workspaceId, task.id, action);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法更新任务');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-1 rounded-lg border border-border p-2 text-xs">
      <p>
        {ACTION_LABELS[task.kind]} · <span>{PHASE_LABELS[task.phase]}</span>
      </p>
      <p className="break-all font-mono">{taskPaths(task)}</p>
      {task.message && <p className="leading-5 text-muted-foreground">{task.message}</p>}
      <ResultFeedback result={task.resultCheck} />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-1">
        {ACTIVE.has(task.phase) && (
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={busy || task.cancelRequested}
            onClick={() => void act('cancel')}
          >
            {task.cancelRequested ? '已请求取消' : '取消任务'}
          </button>
        )}
        {['needs_check', 'cancelled', 'failed'].includes(task.phase) && (
          <button type="button" className={buttonClass('outline')} disabled={busy} onClick={() => void act('check')}>
            {busy ? '正在核对…' : '核对实际结果'}
          </button>
        )}
        {canRecover(task) && (
          <button type="button" className={buttonClass('outline')} disabled={busy} onClick={() => setRecovering(true)}>
            恢复同步
          </button>
        )}
      </div>
      {recovering && <SyncRecovery task={task} close={() => setRecovering(false)} refresh={refresh} />}
    </article>
  );
}

function SyncRecovery({ task, close, refresh }: { task: RemoteFileTask; close(): void; refresh(): void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function recover() {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await api.recoverRemoteFileTask(task.workspaceId, task.id);
      refresh();
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法启动同步恢复');
    } finally {
      setBusy(false);
    }
  }
  return (
    <RemoteDialog
      title="按实际远端结果恢复同步"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="space-y-3 p-4 text-sm">
        <p>
          服务器：<span className="font-mono">{task.sshHost}</span>
        </p>
        <p className="break-all font-mono">
          {task.source ?? '—'}
          {task.destination ? ` → ${task.destination}` : ''}
        </p>
        <p>
          {task.remoteCompleted
            ? '远端操作已完成，相关同步尚未完成。'
            : '远端操作可能只完成了部分文件，请先核对源与目标。'}
        </p>
        <p>
          恢复按实际远端的小文件重建同步基线；可能保留源、目标的部分结果，不会重新执行移动、复制或删除。外部本地修改会保留为冲突。
        </p>
        <p>开始后可在文件任务中取消恢复；关闭面板不会取消。</p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          已核对实际结果，确认恢复相关工作区同步。
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={!confirmed || busy}
          onClick={() => void recover()}
        >
          {busy ? '正在启动…' : '确认恢复同步'}
        </button>
      </div>
    </RemoteDialog>
  );
}

function ResultFeedback({ result }: { result: RemoteFileTask['resultCheck'] }) {
  if (!result) return null;
  const label = (node: { exists: boolean } | undefined) => (node ? (node.exists ? '存在' : '不存在') : '不适用');
  return (
    <p>
      源：{label(result.source)}；目标：{label(result.destination)}。
    </p>
  );
}
