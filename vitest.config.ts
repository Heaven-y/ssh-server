import { defineConfig } from 'vitest/config';

// 每个 workspace 包是一个独立的测试项目，测试文件与源码放在一起（*.test.ts）
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
