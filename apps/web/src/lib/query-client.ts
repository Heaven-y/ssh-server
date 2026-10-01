import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** 4xx（未登录、参数错误、不存在）重试没有意义，只重试网络错误和 5xx */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});
