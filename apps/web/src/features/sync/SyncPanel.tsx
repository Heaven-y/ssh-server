import { useId, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { SyncStatus, Workspace } from '@ssh-server/shared';
import { buttonClass } from '../../ui/styles';
import { DetailDialog } from '../../ui/DetailDialog';
import { SyncSettingsForm } from './SyncSettingsForm';
import { useWorkspaceSync, type SyncAction } from './use-workspace-sync';
import { SettingsLoadError } from '../settings/SettingsLoadError';

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
function StatusSummary({
  status,
  busy,
  intervalSeconds,
}: {
  status: SyncStatus;
  busy: boolean;
  intervalSeconds: number;
}) {
  const Icon = status.phase === 'ready' ? CheckCircle2 : AlertCircle;
  return (
    <div className="min-w-0">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0" aria-hidden />
        {busy ? '正在处理同步请求…' : LABELS[status.phase]}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        只同步代码与小文件（≤ {status.settings.maxFileBytes / 1024 / 1024} MiB）。页面可见时每 {intervalSeconds}{' '}
        秒同步，不触发 AI 分析。
      </p>
      {status.lastSuccessAt && (
        <p className="text-xs leading-5 text-muted-foreground">
          最近成功：{new Date(status.lastSuccessAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
const BRIEF: Record<SyncStatus['phase'], string> = {
  uninitialized: '尚未同步',
  syncing: '正在同步',
  ready: '同步就绪',
  confirmation_required: '同步待确认',
  conflicts: '文件冲突',
  error: '同步失败',
};
function summaryLabel(status: SyncStatus | undefined, busy: boolean, error?: string) {
  if (busy) return '正在同步';
  if (error) return '同步异常';
  if (!status) return '读取同步状态';
  if (status.reason === 'deletions') return '删除待确认';
  if (status.phase === 'ready' && status.lastSuccessAt)
    return `已同步 ${new Date(status.lastSuccessAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  return BRIEF[status.phase];
}

type SyncController = ReturnType<typeof useWorkspaceSync>;
function syncTone(status: SyncStatus | undefined, attention: boolean) {
  if (attention) return 'text-warning';
  return status?.phase === 'ready' ? 'text-success' : 'text-muted-foreground';
}
function controllerError({ query, error, settingsError }: SyncController) {
  return error?.message ?? query.error?.message ?? settingsError?.message;
}
function presentation(controller: SyncController) {
  const { status, busy } = controller;
  const errorMessage = controllerError(controller);
  const attention =
    !!errorMessage || (!!status && ['confirmation_required', 'conflicts', 'error'].includes(status.phase));
  return {
    attention,
    tone: syncTone(status, attention),
    title: errorMessage ?? status?.message ?? '查看同步状态与操作',
    label: summaryLabel(status, busy, errorMessage),
  };
}
function SyncDetails({ controller }: { controller: SyncController }) {
  const { query, status, busy, error, perform, intervalSeconds, settingsError, retrySettings } = controller;
  const errorMessage = error?.message ?? query.error?.message;
  const act = (action: SyncAction) => {
    void perform(action);
  };
  return (
    <>
      {status ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <StatusSummary status={status} busy={busy} intervalSeconds={intervalSeconds} />
            <button className={buttonClass('primary')} disabled={busy} onClick={() => act('sync')}>
              <RefreshCw aria-hidden className={`size-4 ${busy ? 'motion-safe:animate-spin' : ''}`} />
              立即同步
            </button>
          </div>
          {status.message && <p className="mt-4 text-sm leading-6 wrap-anywhere">{status.message}</p>}
          <Decisions status={status} busy={busy} act={act} />
          <SyncSettingsForm key={JSON.stringify(status.settings)} settings={status.settings} busy={busy} save={act} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">正在读取同步状态…</p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-4 text-sm text-destructive-foreground">
          {errorMessage}
        </p>
      )}
      <SettingsLoadError error={settingsError} retry={retrySettings} message="产品设置读取失败，自动同步已暂停" />
      {query.isError && (
        <button
          className={`${buttonClass('outline')} mt-3`}
          onClick={() => {
            void query.refetch();
          }}
        >
          重新读取
        </button>
      )}
    </>
  );
}

/** 只隐藏详情内容，调度 Hook 始终挂载，防止收起面板后停止自动同步。 */
export function SyncPanel({ workspace }: { workspace: Workspace }) {
  const controller = useWorkspaceSync(workspace.id);
  const [expanded, setExpanded] = useState(false);
  const summary = presentation(controller);
  const Icon = summary.attention ? AlertCircle : RefreshCw;
  return (
    <>
      <button
        type="button"
        className={`${buttonClass('ghost')} ${summary.tone} px-2`}
        aria-label="文件同步详情"
        aria-expanded={expanded}
        aria-haspopup="dialog"
        title={summary.title}
        onClick={() => setExpanded(true)}
      >
        <Icon aria-hidden className={`size-3.5 ${controller.busy ? 'motion-safe:animate-spin' : ''}`} />
        <span className="text-xs">{summary.label}</span>
      </button>
      {expanded && (
        <DetailDialog title="文件同步" busy={controller.busy} onClose={() => setExpanded(false)}>
          <SyncDetails controller={controller} />
        </DetailDialog>
      )}
    </>
  );
}
