import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import type { AgentKind } from '@agentdeck/shared/conversation';
import type { CliInstallationStatus } from '@agentdeck/shared/settings';
import { invalidateNativeCapabilities } from '../../cli/shared/capability-cache';
import { settingsKeys } from './api';
import { cliInstallationApi, cliInstallationKey } from './cli-installation-api';
import { sessionToolsKey } from './use-session-tools';

type Tracker = { operationId: string; stop(): void };
const trackers = new WeakMap<QueryClient, Map<AgentKind, Tracker>>();
const completedOperations = new WeakMap<QueryClient, Map<AgentKind, string>>();
const trackingPhases = new Set(['installing', 'updating', 'verifying']);
const MAX_TRACKING_MS = 10 * 60 * 1000;

async function refreshAfterCompletion(client: QueryClient, status: CliInstallationStatus) {
  if (!status.operationId || !['succeeded', 'failed'].includes(status.phase)) return;
  const completed = completedOperations.get(client) ?? new Map<AgentKind, string>();
  if (completed.get(status.agent) === status.operationId) return;
  completed.set(status.agent, status.operationId);
  completedOperations.set(client, completed);
  // 安装失败也可能已改动文件；普通版本检查没有操作 ID，不触发此处失效。
  await Promise.all([
    client.invalidateQueries({ queryKey: settingsKeys.environment }),
    invalidateNativeCapabilities(status.agent, client),
    client.invalidateQueries({ queryKey: sessionToolsKey(status.agent) }),
  ]);
}

function startTracking(client: QueryClient, status: CliInstallationStatus, active: Map<AgentKind, Tracker>) {
  const agent = status.agent;
  const queryKey = cliInstallationKey(agent);
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: ({ signal }) => cliInstallationApi.read(agent, signal),
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
  });
  let removeListener = () => {};
  const tracker: Tracker = {
    operationId: status.operationId!,
    stop() {
      clearTimeout(deadline);
      observer.destroy();
      removeListener();
      if (active.get(agent) === tracker) active.delete(agent);
    },
  };
  // 后端正常任务已有更短的时限；异常宿主也不能让页面永远后台轮询。
  const deadline = setTimeout(() => tracker.stop(), MAX_TRACKING_MS);
  active.set(agent, tracker);
  removeListener = client.getQueryCache().subscribe((event) => {
    // 查询容器被清理时同步释放轮询，避免遗留后台计时器。
    if (event.type === 'removed' && event.query.queryHash === observer.getCurrentQuery().queryHash) tracker.stop();
  });
  observer.subscribe((result) => {
    // 断线后停止自动重试；重新打开面板或手动重读可恢复该任务。
    if (result.isError) tracker.stop();
    else if (result.data) void observeCliInstallation(client, result.data);
  });
}

function isCurrentStatus(client: QueryClient, status: CliInstallationStatus) {
  const current = client.getQueryData<CliInstallationStatus>(cliInstallationKey(status.agent));
  return current?.operationId === status.operationId && current?.phase === status.phase;
}

/** 每个 CLI 只保留一个后台观察者；与页面共用查询，卸载卡片不取消已受理任务的收尾。 */
export async function observeCliInstallation(client: QueryClient, status: CliInstallationStatus) {
  if (!isCurrentStatus(client, status)) return;
  const active = trackers.get(client) ?? new Map<AgentKind, Tracker>();
  trackers.set(client, active);
  const previous = active.get(status.agent);
  if (previous && previous.operationId !== status.operationId) previous.stop();
  if (status.operationId && trackingPhases.has(status.phase)) {
    if (!active.has(status.agent)) startTracking(client, status, active);
    return;
  }
  active.get(status.agent)?.stop();
  await refreshAfterCompletion(client, status);
}
