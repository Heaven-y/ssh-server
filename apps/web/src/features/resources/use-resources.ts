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

function usePageVisible(intervalMs: number) {
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
    if (!visible) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [visible, intervalMs]);
  return { visible, now };
}

/** 概览和详情只持有一个查询；禁用时取消仍在途的采样，不追加服务器操作。 */
export function useResources(workspace: Workspace) {
  const settings = useProductSettings();
  const connection = useChat((state) => state.connection);
  const client = useQueryClient();
  const timing = settings.data ? resourceTiming(settings.data.settings.resources) : RESOURCE_LIMITS;
  const target = workspaceTerminalTarget(workspace);
  const targetKey = terminalTargetKey(target);
  const { visible, now } = usePageVisible(timing.intervalMs);
  const active = visible && connection === 'open' && settings.isSuccess;
  const query = useQuery({
    queryKey: ['resources', workspace.id, targetKey],
    queryFn: ({ signal }) => api.readResources(target, signal),
    enabled: active,
    staleTime: 0,
    gcTime: RESOURCE_LIMITS.idleMs,
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
    if (!active) void client.cancelQueries({ queryKey: ['resources', workspace.id, targetKey], exact: true });
  }, [active, client, workspace.id, targetKey]);
  const pauseReason = !visible
    ? '页面隐藏，已暂停'
    : connection !== 'open'
      ? '网页断线，已暂停'
      : !settings.isSuccess
        ? '产品设置未就绪，已暂停'
        : undefined;
  return { query, target, visible, now, timing, settings, active, pauseReason };
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
