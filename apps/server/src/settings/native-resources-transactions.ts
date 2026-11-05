import path from 'node:path';

// 旧配置接口与资源接口共用文件锁；多个 CLI 也可能指向同一个 AGENTS.md。
const queues = new Map<string, Promise<unknown>>();

export function nativeFileTransaction<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const absolute = path.resolve(file);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const run = (queues.get(key) ?? Promise.resolve()).then(operation, operation);
  queues.set(key, run);
  void run
    .finally(() => {
      if (queues.get(key) === run) queues.delete(key);
    })
    .catch(() => undefined);
  return run;
}
