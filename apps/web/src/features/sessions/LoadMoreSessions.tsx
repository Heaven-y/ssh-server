import { buttonClass } from '../../ui/styles';
export function LoadMoreSessions({ more, loading, hasMore }: { more(): void; loading: boolean; hasMore: boolean }) {
  if (!hasMore) return null;
  return (
    <button type="button" className={`${buttonClass('ghost')} mx-2 my-2 text-xs`} disabled={loading} onClick={more}>
      {loading ? '正在读取…' : '加载更多会话'}
    </button>
  );
}
