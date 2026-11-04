import { useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';

export type ConsoleView = 'overview' | 'processes' | 'files' | 'terminals';
export type ConsoleServerTab = { serverId: string; directory: string };
export const consoleError = (error: unknown) =>
  error instanceof ApiError ? error.message : '无法访问 SSH 控制台，请检查本机服务后重试。';
export const formatBytes = (bytes: number | null) => {
  if (bytes === null) return '不可用';
  const exponent = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.max(1, bytes)) / 10)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB'][exponent]}`;
};
export const formatPercent = (value: number | null) => (value === null ? '不可用' : `${value.toFixed(1)}%`);

export function useConsoleVisible(visible: boolean) {
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible && pageVisible;
}
