import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';

const focusReaders = new WeakMap<QueryClient, { count: number; changed(): void }>();
function subscribeFocus(client: QueryClient) {
  let entry = focusReaders.get(client);
  if (!entry) {
    entry = {
      count: 0,
      changed: () => {
        if (document.visibilityState === 'visible')
          void client.invalidateQueries({ queryKey: queryKeys.productSettings }, { cancelRefetch: false });
      },
    };
    focusReaders.set(client, entry);
    window.addEventListener('focus', entry.changed);
  }
  entry.count++;
  const subscribed = entry;
  return () => {
    if (--subscribed.count === 0) {
      window.removeEventListener('focus', subscribed.changed);
      focusReaders.delete(client);
    }
  };
}

/** 多组件共用同一请求；返回窗口时重读其他客户端保存的产品偏好。 */
export function useProductSettings() {
  const client = useQueryClient();
  useEffect(() => subscribeFocus(client), [client]);
  return useQuery({
    queryKey: queryKeys.productSettings,
    queryFn: ({ signal }) => api.readProductSettings(signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
