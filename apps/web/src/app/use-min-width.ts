import { useCallback, useSyncExternalStore } from 'react';

/** 两种停靠方向共用媒体查询，不通过重新挂载切换布局。 */
export function useMinWidth(width: number) {
  const query = `(min-width: ${width}px)`;
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
