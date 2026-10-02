import { useId, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { SyncStatus, Workspace } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { SyncSettingsForm } from './SyncSettingsForm';
import { useWorkspaceSync, type SyncAction } from './use-workspace-sync';

type Actions = { busy: boolean; act(action: SyncAction): void };
const LABELS: Record<SyncStatus['phase'], string> = {
  uninitialized: '尚未建立同步基线',
  syncing: '正在同步',
  ready: '同步就绪',
  confirmation_required: '同步等待确认',
  conflicts: '文件冲突待处理',
  error: '同步失败，执行已暂停',
};
function Initialization({ busy, act }: Actions) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs leading-5 text-muted-foreground">
        初始化或恢复会重新比对两端文件，并保留同名差异。确认前请核对本地与服务器目录。
      </p>
      <label htmlFor={id} className="flex items-center gap-2 text-xs">
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        我已核对两端目录，确认重建同步基线
      </label>
      <button
        className={`${buttonClass('primary')} w-fit`}
        disabled={busy || !confirmed}
        onClick={() => act('initialize')}
      >
        确认初始化或恢复
      </button>
    </div>
  );
}
function Deletions({ status, busy, act }: { status: SyncStatus } & Actions) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs leading-5">以下本地删除尚未传播到服务器，该工作区同步与执行已暂停。</p>
      <ul className="max-h-28 list-inside list-disc overflow-auto font-mono text-xs leading-5 wrap-anywhere">
        {status.deletions.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass('outline')} disabled={busy} onClick={() => act('reject')}>
          恢复本地文件
        </button>
        <button className={buttonClass('danger')} disabled={busy} onClick={() => act('confirm')}>
          确认同步删除
        </button>
      </div>
    </div>
  );
}
function Conflicts({ status, busy, act }: { status: SyncStatus } & Actions) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs leading-5">
        双方版本已保留。请在本地将选定内容写回原路径，再确认；保留的副本不会自动删除。
      </p>
      <ul className="max-h-36 overflow-auto text-xs leading-5">
        {status.conflicts.map((file) => (
          <li key={file.path} className="mb-2 font-mono wrap-anywhere">
            <div>{file.path}</div>
            <div className="text-muted-foreground">本地版本：{file.localCopy}</div>
            <div className="text-muted-foreground">服务器版本：{file.remoteCopy}</div>
          </li>
        ))}
      </ul>
      <button className={`${buttonClass('primary')} w-fit`} disabled={busy} onClick={() => act('ack')}>
        已恢复原路径，确认处理完成
      </button>
    </div>
  );
}
function Decisions({ status, ...actions }: { status: SyncStatus } & Actions) {
  if (status.reason === 'deletions') return <Deletions status={status} {...actions} />;
  if (status.phase === 'conflicts') return <Conflicts status={status} {...actions} />;
  if (['confirmation_required', 'error'].includes(status.phase)) return <Initialization {...actions} />;
  return null;
}
function StatusSummary({ status, busy }: { status: SyncStatus; busy: boolean }) {
  const Icon = status.phase === 'ready' ? CheckCircle2 : AlertCircle;
  return (
    <div className="min-w-0">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0" aria-hidden />
        {busy ? '正在处理同步请求…' : LABELS[status.phase]}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        只同步代码与小文件（≤ {status.settings.maxFileBytes / 1024 / 1024} MiB）。页面可见时每 15 秒同步，不触发 AI
        分析。
      </p>
      {status.lastSuccessAt && (
        <p className="text-xs leading-5 text-muted-foreground">
          最近成功：{new Date(status.lastSuccessAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
export function SyncPanel({ workspace }: { workspace: Workspace }) {
  const { query, status, busy, error, perform } = useWorkspaceSync(workspace.id);
  const act = (action: SyncAction) => {
    void perform(action);
  };
  const errorMessage = error?.message ?? query.error?.message;
  if (!status)
    return (
      <section aria-label="文件同步" className="shrink-0 border-b border-border bg-card px-4 py-3 text-xs">
        {errorMessage ? <p role="alert">{errorMessage}</p> : '正在读取同步状态…'}
        {query.isError && (
          <button
            className={`${buttonClass('outline')} mt-2`}
            onClick={() => {
              void query.refetch();
            }}
          >
            重新读取
          </button>
        )}
      </section>
    );
  return (
    <section
      aria-label="文件同步"
      className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-border bg-card px-4 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <StatusSummary status={status} busy={busy} />
        <button className={buttonClass('outline')} disabled={busy} onClick={() => act('sync')}>
          <RefreshCw className={`size-4 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
          立即同步
        </button>
      </div>
      {status.message && <p className="mt-2 text-xs leading-5 wrap-anywhere">{status.message}</p>}
      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-destructive-foreground">
          {errorMessage}
        </p>
      )}
      <Decisions status={status} busy={busy} act={act} />
      <SyncSettingsForm key={JSON.stringify(status.settings)} settings={status.settings} busy={busy} save={act} />
    </section>
  );
}
