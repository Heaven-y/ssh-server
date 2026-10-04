import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncSettings, SyncStatus } from '@ssh-server/shared';
import { api, queryKeys } from '../../lib/api';
import { scheduleVisibleSync } from './scheduler';
import { useProductSettings } from '../settings/use-product-settings';

export type SyncAction = 'sync' | 'initialize' | 'confirm' | 'reject' | 'ack' | SyncSettings;
function apply(id: string, action: SyncAction): Promise<SyncStatus> {
  if (typeof action === 'object') return api.updateSyncSettings(id, action);
  switch (action) {
    case 'initialize':
      return api.initializeSync(id);
    case 'confirm':
    case 'reject':
      return api.decideSyncDeletions(id, action);
    case 'ack':
      return api.acknowledgeSyncConflicts(id);
    case 'sync':
      return api.syncWorkspace(id);
  }
}
function usePageVisible() {
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  return visible;
}
export function useWorkspaceSync(id: string) {
  const settings = useProductSettings();
  const intervalMs = (settings.data?.settings.syncIntervalSeconds ?? 15) * 1000;
  const client = useQueryClient();
  const visible = usePageVisible();
  const query = useQuery({
    queryKey: queryKeys.sync(id),
    queryFn: () => api.syncStatus(id),
    enabled: visible,
    refetchInterval: visible ? 3000 : false,
    retry: false,
  });
  const { mutateAsync, isPending, error } = useMutation({
    mutationFn: (action: SyncAction) => apply(id, action),
    onSuccess: async (status, action) => {
      client.setQueryData(queryKeys.sync(id), status);
      if (typeof action === 'object') await client.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
  const inFlight = useRef(false);
  const scheduledWorkspace = useRef<string | undefined>(undefined);
  const perform = useCallback(
    async (action: SyncAction) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await mutateAsync(action);
      } catch {
        /* mutation.error 在面板内显示。 */
      } finally {
        inFlight.current = false;
      }
    },
    [mutateAsync],
  );
  const current = useRef({ status: query.data, failed: !!error });
  useEffect(() => {
    current.current = { status: query.data, failed: !!error };
  }, [query.data, error]);
  useEffect(() => {
    if (!query.isSuccess || !settings.isSuccess) return;
    const immediate = scheduledWorkspace.current !== id;
    scheduledWorkspace.current = id;
    return scheduleVisibleSync({
      page: document,
      intervalMs,
      immediate,
      sync: () => perform('sync'),
      shouldSync: () =>
        !inFlight.current &&
        !current.current.failed &&
        ['ready', 'uninitialized'].includes(current.current.status?.phase ?? ''),
    });
  }, [id, query.isSuccess, settings.isSuccess, intervalMs, perform]);
  return {
    query,
    status: query.data,
    busy: isPending || query.data?.phase === 'syncing',
    error,
    perform,
    intervalSeconds: intervalMs / 1000,
    settingsError: settings.error,
    retrySettings: settings.refetch,
  };
}
