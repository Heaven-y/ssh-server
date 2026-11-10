import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallationStatus, CliInstallPhase, EnvironmentTool } from '@agentdeck/shared/settings';
import { RefreshCw } from 'lucide-react';
import { buttonClass } from '../../ui/styles';
import { useChat } from '../chat/chat-store';
import { conversationBusy, conversationViews } from '../chat/conversations';
import { nativeAgentNames } from './native-resource-labels';
import { cliInstallationError, useCliInstallation } from './use-cli-installation';

type State = ReturnType<typeof useCliInstallation>;
const progress: Partial<Record<CliInstallPhase, string>> = {
  checking: '正在检查更新…',
  installing: '正在安装…',
  updating: '正在更新…',
  verifying: '正在验证安装结果…',
};
const pendingPhase = { check: 'checking', install: 'installing', update: 'updating' } as const;
const sourceLabels = { npm: 'npm 安装', native: '原生安装', unknown: '安装来源未知', missing: '尚未安装' };

function versionsChecked(status: CliInstallationStatus) {
  return status.installed && !!status.currentVersion && !!status.latestVersion && status.checkedAt !== null;
}
function availableAction(status: CliInstallationStatus) {
  if (!status.installed && status.canInstall) return 'install';
  if (status.installed && status.canUpdate && status.updateAvailable) return 'update';
  return undefined;
}
function needsGuide(status: CliInstallationStatus | undefined, health?: EnvironmentTool) {
  return (
    status &&
    (health?.available === false || status.source === 'unknown' || !status.installed || status.phase === 'failed')
  );
}
function InstallationVersions({ status }: { status: CliInstallationStatus }) {
  return (
    <>
      <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-xs leading-5">
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-muted-foreground">当前版本</dt>
          <dd className="break-all">{status.installed ? (status.currentVersion ?? '版本未知') : '未安装'}</dd>
        </div>
        <div className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-muted-foreground">最新版本</dt>
          <dd className="break-all">{status.latestVersion ?? '尚未检查'}</dd>
        </div>
        <div className="text-muted-foreground">
          <dt className="sr-only">安装来源</dt>
          <dd>{sourceLabels[status.source]}</dd>
        </div>
      </dl>
    </>
  );
}
function InstallationActions({ state, disabled }: { state: State; disabled: boolean }) {
  const status = state.status.data;
  if (!status) return null;
  const action = availableAction(status);
  const checking = state.pendingAction === 'check' || status.phase === 'checking';
  const blocked = state.busy || state.status.isFetching;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass('ghost')} disabled={blocked} onClick={() => state.act('check')}>
        <RefreshCw aria-hidden className={`size-3.5 ${checking ? 'motion-safe:animate-spin' : ''}`} />
        {checking ? '正在检查…' : '检查更新'}
      </button>
      {action && (
        <button
          type="button"
          className={buttonClass('outline')}
          disabled={disabled || blocked || state.status.isError}
          onClick={() => state.act(action)}
        >
          {action === 'install' ? '安装' : '更新'}
        </button>
      )}
    </div>
  );
}
function InstallationResult({ status, healthy }: { status: CliInstallationStatus; healthy: boolean }) {
  const checked = versionsChecked(status) && status.phase !== 'failed' && (healthy || status.updateAvailable);
  return (
    <>
      {status.message && (
        <p
          role={status.phase === 'failed' ? 'alert' : 'status'}
          className={`break-words text-xs leading-5 ${status.phase === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground'}`}
        >
          {status.message}
        </p>
      )}
      {checked && (
        <p role="status" className={`text-xs ${status.updateAvailable ? 'text-muted-foreground' : 'text-success'}`}>
          {status.updateAvailable ? '有新版本可用' : '已是最新版本'}
        </p>
      )}
    </>
  );
}
function InstallationFeedback({ state, healthy }: { state: State; healthy: boolean }) {
  const status = state.status.data;
  const phase = state.pendingAction ? pendingPhase[state.pendingAction] : status?.phase;
  if (state.error)
    return (
      <p role="alert" className="text-xs leading-5 text-destructive-foreground">
        {cliInstallationError(state.error)}
      </p>
    );
  if (state.busy)
    return (
      <div role="status" className="space-y-1 text-xs leading-5 text-muted-foreground">
        <p>{state.pendingAction === 'install' ? '正在准备安装…' : phase && progress[phase]}</p>
        {phase !== 'checking' && <p>可关闭设置或切换 CLI，任务会继续进行。</p>}
      </div>
    );
  if (!status)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        正在读取安装状态…
      </p>
    );
  return <InstallationResult status={status} healthy={healthy} />;
}

function InstallationHealth({ health }: { health?: EnvironmentTool }) {
  if (!health) return null;
  return (
    <div role={health.available ? 'status' : 'alert'} className="space-y-1 text-xs leading-5">
      <p className={health.available ? 'text-success' : 'text-warning'}>{health.available ? '可用' : '不可用'}</p>
      {health.message && <p className="break-words text-muted-foreground">{health.message}</p>}
    </div>
  );
}

export function CliInstallationPanel({
  agent,
  disabled = false,
  health,
}: {
  agent: AgentKind;
  disabled?: boolean;
  health?: EnvironmentTool;
}) {
  const state = useCliInstallation(agent);
  const running = useChat((chat) =>
    conversationViews(chat).some((view) => view.agent === agent && conversationBusy(view)),
  );
  const status = state.status.data;
  return (
    <section
      aria-label={`${nativeAgentNames[agent]} 安装与更新`}
      aria-busy={state.busy || state.status.isPending}
      className="min-w-0 space-y-2.5 rounded-lg border border-border bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-medium">{nativeAgentNames[agent]} CLI</h4>
        <InstallationActions state={state} disabled={disabled || running} />
      </div>
      {status && <InstallationVersions status={status} />}
      <InstallationHealth health={health} />
      <InstallationFeedback state={state} healthy={health?.available !== false} />
      {state.error && (
        <button type="button" className={buttonClass('ghost')} disabled={state.status.isFetching} onClick={state.retry}>
          重试读取
        </button>
      )}
      {running && <p className="text-xs leading-5 text-muted-foreground">结束此 CLI 的运行会话后再安装或更新。</p>}
      {needsGuide(status, health) && (
        <a
          className="inline-flex min-h-8 items-center text-xs text-accent underline underline-offset-2"
          href={status?.guideUrl}
          target="_blank"
          rel="noreferrer"
        >
          官方安装指南
        </a>
      )}
    </section>
  );
}
