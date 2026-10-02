import { defineConfig } from 'vitest/config';

// 每个 workspace 包是一个独立的测试项目，测试集中放在各包的 tests 目录
// 覆盖率只能在根配置统一设置；门槛按包和目录分别给出，说明见 docs/guides/dev-environment.md 1.3
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // 进程入口：只做组装，由 e2e 验收覆盖
        'apps/server/src/main.ts',
        'apps/server/src/remote-tools/main.ts',
        'apps/web/src/main.tsx',
        // 需要真实 SSH 连接，由 scripts/dev/ssh-smoke.ts 与 e2e 验收覆盖
        'apps/server/src/ssh/pool.ts',
        // 只有类型或样式常量
        'packages/shared/src/events.ts',
        'apps/web/src/ui/styles.ts',
        // 界面组件：M1 由浏览器冒烟检查覆盖，组件测试在 M6 引入
        'apps/web/src/**/*.tsx',
        // 从 SSH 组件抽出的交互 Hook：沿用该组件的浏览器验收范围，组件测试在 M6 接入。
        'apps/web/src/features/ssh/use-ssh-connection.ts',
        // 浏览器 WebSocket 封装，逻辑交给 partysocket；状态处理在 chat-store 中测试
        'apps/web/src/lib/ws.ts',
      ],
      thresholds: {
        // 全局底线
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
        // 安全边界：黑名单与访问控制要求更高
        'apps/server/src/policy/**': { lines: 95, branches: 85, functions: 95, statements: 95 },
        'apps/server/src/http/security.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'packages/shared/src/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
