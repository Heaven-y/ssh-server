import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient, type QueryCacheNotifyEvent } from '@tanstack/react-query';
import type { ManagedServer } from '@ssh-server/shared';
import { queryKeys } from '../../lib/api';

function observation(client: QueryClient, alias: string) {
  return {
    profile: JSON.stringify(
      client.getQueryData<ManagedServer[]>(queryKeys.sshHosts)?.find((item) => item.alias === alias),
    ),
    credentials: JSON.stringify(client.getQueryData(queryKeys.sshCredentials(alias))),
  };
}
function changed(before: ReturnType<typeof observation>, after: ReturnType<typeof observation>) {
  return (
    (before.profile !== undefined && before.profile !== after.profile) ||
    (before.credentials !== undefined && before.credentials !== after.credentials)
  );
}
function relevant(event: QueryCacheNotifyEvent, alias: string) {
  if (event.type !== 'updated' && event.type !== 'removed') return false;
  const key = JSON.stringify(event.query.queryKey);
  return key === JSON.stringify(queryKeys.sshHosts) || key === JSON.stringify(queryKeys.sshCredentials(alias));
}

/** 只监听公开档案/状态的变化与显式重认证失效，不发送或推导服务端认证摘要。 */
export function useServerObservationVersion(alias: string) {
  const client = useQueryClient();
  const [state, setState] = useState({ alias, version: 0 });
  useEffect(() => {
    let previous = observation(client, alias);
    return client.getQueryCache().subscribe((event) => {
      if (!relevant(event, alias)) return;
      const next = observation(client, alias);
      const reauth =
        event.type === 'updated' &&
        event.action.type === 'invalidate' &&
        JSON.stringify(event.query.queryKey) === JSON.stringify(queryKeys.sshCredentials(alias));
      if (changed(previous, next) || reauth)
        setState((current) => ({ alias, version: current.alias === alias ? current.version + 1 : 1 }));
      previous = next;
    });
  }, [client, alias]);
  return state.alias === alias ? state.version : 0;
}
