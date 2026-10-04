import { defineConfig } from 'vitest/config';

// 默认纯函数使用 node；需要实际Hook生命周期的用例在文件顶部指定jsdom。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
