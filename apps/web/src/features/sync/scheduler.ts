// 可见工作区每 15 秒同步；隐藏、待确认或正在处理请求时不发起传输。
type Page = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
type Options = { page: Page; sync(): Promise<void>; shouldSync(): boolean };
export function scheduleVisibleSync(options: Options): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = async () => {
    if (stopped || running || options.page.visibilityState !== 'visible' || !options.shouldSync()) return;
    running = true;
    try {
      await options.sync();
    } catch {
      /* 请求调用方显示错误；调度器下次仍可运行。 */
    } finally {
      running = false;
    }
  };
  const visibleChanged = () => {
    clearInterval(timer);
    timer = undefined;
    if (stopped || options.page.visibilityState !== 'visible') return;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, 15_000);
  };
  options.page.addEventListener('visibilitychange', visibleChanged);
  visibleChanged();
  return () => {
    stopped = true;
    clearInterval(timer);
    options.page.removeEventListener('visibilitychange', visibleChanged);
  };
}
