import { defineConfig } from 'vitest/config';

// 桌面壳只测启动编排；真实开窗与 preload 注入在能显示窗口的机器上手工验收。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
