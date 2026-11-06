import { expect, it, vi } from 'vitest';
import { createSessionCatalog } from '../../src/sessions/catalog';
import type { NativeSessionRow } from '../../src/agents/contracts';

it('并发元数据只读一次，单个调用方取消不会中止其他项目，全部取消才终止', async () => {
  const catalog = createSessionCatalog();
  let nativeSignal: AbortSignal | undefined;
  const load = vi.fn((signal: AbortSignal) => {
    nativeSignal = signal;
    return new Promise<NativeSessionRow[]>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true });
    });
  });
  const first = new AbortController();
  const second = new AbortController();
  const requests = Promise.allSettled([
    catalog.read('codex', false, load, first.signal),
    catalog.read('codex', false, load, second.signal),
  ]);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  first.abort();
  expect(nativeSignal?.aborted).toBe(false);
  second.abort();
  expect(nativeSignal?.aborted).toBe(true);
  expect((await requests).map((result) => result.status)).toEqual(['rejected', 'rejected']);
});

it('共享仅限在途请求，完成后的刷新可立即看到新增原生会话', async () => {
  const catalog = createSessionCatalog();
  const load = vi.fn(async (): Promise<NativeSessionRow[]> => []);
  await catalog.read('claude', false, load);
  load.mockResolvedValueOnce([{ sessionId: 'new', summary: '新会话', lastModified: 1 }]);
  expect((await catalog.read('claude', false, load)).map((row) => row.sessionId)).toEqual(['new']);
});

it('超过元数据预算时不返回截断列表，失败后允许重新读取', async () => {
  const catalog = createSessionCatalog();
  const load = vi.fn(async (): Promise<NativeSessionRow[]> =>
    Array.from({ length: 100001 }, () => ({ sessionId: 'fixture', summary: '', lastModified: 1 })),
  );
  await expect(catalog.read('antigravity', false, load)).rejects.toThrow('超过上限');
  load.mockResolvedValueOnce([]);
  await expect(catalog.read('antigravity', false, load)).resolves.toEqual([]);
});
