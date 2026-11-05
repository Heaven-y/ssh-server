import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // 服务端用例大量启动真实子进程（Codex app-server 夹具、SSH 夹具、探测命令）。
    // 全量并行时 100+ 个 worker 同时 fork，进程启动与首包往返会被明显拖慢，
    // 默认 5 秒预算会让本身正确的用例偶发超时。这里统一放宽等待预算；
    // 断言与被测行为不变，需要更快暴露回归的用例仍可在用例上写更小的显式超时。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
