import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../../lib/api';

/** 多组件共用同一请求；返回窗口时重读其他客户端保存的产品偏好。 */
export function useProductSettings() {
  return useQuery({
    queryKey: queryKeys.productSettings,
    queryFn: ({ signal }) => api.readProductSettings(signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
