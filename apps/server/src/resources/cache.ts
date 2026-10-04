import { RESOURCE_LIMITS, type ResourceReading, type ResourceTiming } from '@ssh-server/shared';

type Entry<T> = {
  data: T | null;
  sampledAt: number | null;
  retryAt: number;
  failures: number;
  lastAccess: number;
  message: string | null;
  controller?: AbortController;
  pending?: Promise<void>;
};
function nextSampleAt<T>(item: Entry<T>, intervalMs: number): number {
  if (item.message) return item.retryAt;
  return item.sampledAt === null ? 0 : item.sampledAt + intervalMs;
}
/** 请求驱动：空闲时不创建采样计时器，同一个key只运行一次。 */
export class ResourceCache<T> {
  private entries = new Map<string, Entry<T>>();
  private disposed = false;
  constructor(private readonly limit: number) {}

  private entry(key: string): Entry<T> {
    const now = Date.now();
    for (const [id, item] of this.entries) {
      if (!item.pending && now - item.lastAccess >= RESOURCE_LIMITS.idleMs) this.entries.delete(id);
    }
    let item = this.entries.get(key);
    if (item) {
      item.lastAccess = now;
      return item;
    }
    if (this.entries.size >= this.limit) {
      const oldest = [...this.entries]
        .filter(([, value]) => !value.pending)
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
      if (!oldest) throw new Error('资源采样名额已满');
      this.entries.delete(oldest[0]);
    }
    item = { data: null, sampledAt: null, retryAt: 0, failures: 0, lastAccess: now, message: null };
    this.entries.set(key, item);
    return item;
  }
  async get(
    key: string,
    load: (previous: T | null, signal: AbortSignal) => Promise<T>,
    timing: ResourceTiming = RESOURCE_LIMITS,
  ): Promise<ResourceReading<T>> {
    if (this.disposed) throw new Error('资源采样服务已关闭');
    const item = this.entry(key);
    const retryAt = nextSampleAt(item, timing.intervalMs);
    if (!item.pending && Date.now() >= retryAt) {
      const controller = new AbortController();
      item.controller = controller;
      item.pending = load(item.data, AbortSignal.any([controller.signal, AbortSignal.timeout(timing.timeoutMs)]))
        .then((data) => {
          controller.signal.throwIfAborted();
          item.data = data;
          item.sampledAt = Date.now();
          item.failures = 0;
          item.message = null;
          item.retryAt = item.sampledAt + timing.intervalMs;
        })
        .catch(() => {
          item.failures++;
          item.retryAt = Date.now() + Math.min(30000, timing.intervalMs * 2 ** Math.min(item.failures - 1, 3));
          item.message = '采样失败，保留最近数据；请检查SSH连接或现有工具';
        })
        .finally(() => {
          item.pending = undefined;
          item.controller = undefined;
        });
    }
    await item.pending;
    if (this.disposed) throw new Error('资源采样服务已关闭');
    return {
      data: item.data,
      sampledAt: item.sampledAt,
      retryAt: item.message ? item.retryAt : null,
      message: item.message,
      stale: !!item.message || item.sampledAt === null || Date.now() - item.sampledAt > timing.staleMs,
    };
  }
  dispose(): void {
    this.disposed = true;
    for (const item of this.entries.values()) item.controller?.abort();
    this.entries.clear();
  }
}
