import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RESOURCE_LIMITS,
  resourceTiming,
  workspaceTerminalTarget,
  terminalTargetKey,
  type Workspace,
  type ResourceSnapshot,
} from '@ssh-server/shared';
import { api, ApiError } from '../../lib/api';
import { useProductSettings } from '../settings/use-product-settings';
import { useChat } from '../chat/chat-store';
import { useServerObservationVersion } from './use-server-observation';

function usePageVisible(intervalMs: number, enabled: boolean) {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const change = () => {
      setVisible(document.visibilityState === 'visible');
      setNow(Date.now());
    };
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (!visible || !enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [visible, intervalMs, enabled]);
  return { visible, now };
}

/** 资源面板只持有一个查询；自身隐藏时取消在途请求，停止采样与时钟刷新。 */
export function useResources(workspace: Workspace, panelVisible: boolean) {
  const settings = useProductSettings();
  const connection = useChat((state) => state.connection);
  const client = useQueryClient();
  const timing = settings.data ? resourceTiming(settings.data.settings.resources) : RESOURCE_LIMITS;
  const target = workspaceTerminalTarget(workspace);
  const targetKey = terminalTargetKey(target);
  const version = useServerObservationVersion(workspace.sshHost);
  const { visible, now } = usePageVisible(timing.intervalMs, panelVisible);
  const canRead = panelVisible && visible && connection === 'open';
  const active = canRead && settings.isSuccess;
  const query = useQuery({
    queryKey: ['resources', workspace.id, targetKey, version],
    queryFn: ({ signal }) => api.readResources(target, signal),
    enabled: active,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: (state) => {
      if (!active) return false;
      const error = state.state.error;
      return error instanceof ApiError && ['target_changed', 'workspace_missing'].includes(error.code ?? '')
        ? false
        : timing.intervalMs;
    },
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (!active) void client.cancelQueries({ queryKey: ['resources', workspace.id, targetKey, version], exact: true });
  }, [active, client, workspace.id, targetKey, version]);
  const pauseReason = resourcePauseReason(panelVisible, visible, connection === 'open', settings.isSuccess);
  return { query, target, visible, now, timing, settings, active, canRead, pauseReason };
}
function resourcePauseReason(panel: boolean, page: boolean, connected: boolean, ready: boolean) {
  if (!panel) return '资源已隐藏，已暂停';
  if (!page) return '页面隐藏，已暂停';
  if (!connected) return '网页断线，已暂停';
  return ready ? undefined : '产品设置未就绪，已暂停';
}
export type ResourcesController = ReturnType<typeof useResources>;
export function readingState(
  snapshot: ResourceSnapshot | undefined,
  error: Error | null,
  now: number,
  staleMs: number,
) {
  const readings = [snapshot?.host, snapshot?.disk];
  const stale =
    !!error ||
    readings.some(
      (reading) => !reading || reading.stale || reading.sampledAt === null || now - reading.sampledAt > staleMs,
    );
  const message = error instanceof ApiError ? error.message : readings.find((reading) => reading?.message)?.message;
  return { stale, message };
}
export const resourceTime = (at: number | null | undefined) =>
  at === null || at === undefined ? '尚无成功采样' : new Date(at).toLocaleTimeString('zh-CN');
