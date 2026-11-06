import { expect, it, vi } from 'vitest';
import { createSessionPageCache } from '../../src/sessions/page-cache';
import type { NativeSessionPage } from '../../src/agents/contracts';
const source = { agent: 'codex' as const, archived: false };

it('并发分页共享读取；部分取消保留其他订阅，全部取消不缓存迟到结果', async () => {
  const cache = createSessionPageCache();
  let finish!: (page: NativeSessionPage) => void;
  let nativeSignal!: AbortSignal;
  const load = vi.fn((signal: AbortSignal) => {
    nativeSignal = signal;
    return new Promise<NativeSessionPage>((resolve) => {
      finish = resolve;
    });
  });
  const a = new AbortController();
  const b = new AbortController();
  const first = Promise.allSettled([cache.read(source, load, a.signal), cache.read(source, load, b.signal)]);
  await Promise.resolve();
  a.abort();
  expect(nativeSignal.aborted).toBe(false);
  b.abort();
  expect(nativeSignal.aborted).toBe(true);
  expect((await first).map((entry) => entry.status)).toEqual(['rejected', 'rejected']);
  finish({ items: [] });
  await Promise.resolve();
  const fresh = vi.fn(async () => ({ items: [] }));
  await cache.read(source, fresh);
  expect(fresh).toHaveBeenCalledOnce();
});

it('来源失效拒绝旧在途结果，页预算回收旧页但不影响其他来源', async () => {
  const cache = createSessionPageCache();
  let finish!: (page: NativeSessionPage) => void;
  const pending = cache.read(
    source,
    () =>
      new Promise<NativeSessionPage>((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve();
  const oldRevision = cache.revision('codex');
  cache.invalidate('codex');
  finish({ items: [] });
  await rejected;
  expect(cache.revision('codex')).not.toBe(oldRevision);
  const load = vi.fn(async () => ({ items: [] }));
  for (let index = 0; index < 33; index++) await cache.read({ ...source, cursor: String(index) }, load);
  expect(load).toHaveBeenCalledTimes(33);
  await cache.read({ ...source, cursor: '32' }, load);
  expect(load).toHaveBeenCalledTimes(33);
  await cache.read({ ...source, cursor: '0' }, load);
  expect(load).toHaveBeenCalledTimes(34);
});
