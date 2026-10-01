import { defineConfig } from 'vitest/config';

// 前端单元测试只测纯函数，用 node 环境即可
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
