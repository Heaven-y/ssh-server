import WebSocket from 'ws';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

/** 打包验收只用 Chromium 原生调试协议，不向产品注入测试后门。 */
export async function connectCdp(url: string) {
  const socket = new WebSocket(url);
  const pending = new Map<number, Pending>();
  let sequence = 0;
  socket.on('message', (raw) => {
    const bytes = Buffer.isBuffer(raw) ? raw : raw instanceof ArrayBuffer ? Buffer.from(raw) : Buffer.concat(raw);
    const value = JSON.parse(bytes.toString('utf8')) as { id?: number; result?: unknown; error?: { message?: string } };
    if (value.id === undefined) return;
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    clearTimeout(request.timer);
    if (value.error) request.reject(new Error(value.error.message ?? '调试协议调用失败'));
    else request.resolve(value.result);
  });
  socket.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('桌面调试连接已关闭'));
    }
    pending.clear();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`调试调用超时：${method}`));
      }, 15000);
      pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  return {
    call,
    async evaluate<T>(expression: string): Promise<T> {
      const value = await call<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (value.exceptionDetails) throw new Error('桌面验收表达式执行失败');
      return value.result.value;
    },
    close: () => socket.close(),
  };
}

export async function eventually<T>(
  probe: () => Promise<T | undefined>,
  description: string,
  timeout = 30000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch {
      /* 启动和退出期间端口暂不可访问，继续等到有界期限。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待超时：${description}`);
}
