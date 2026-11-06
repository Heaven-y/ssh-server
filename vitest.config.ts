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
        'apps/web/src/main.tsx',
        // 桌面壳的进程入口与 preload：需要真实窗口才能执行，按手工验收覆盖
        'apps/desktop/src/main.ts',
        'apps/desktop/src/preload.ts',
        // 需要真实 SSH 连接，由 scripts/dev/ssh-smoke.ts 与 e2e 验收覆盖
        'apps/server/src/builtin-plugins/ssh-console/ssh/pool.ts',
        // 只有类型或样式常量
        'packages/shared/src/conversation/events.ts',
        'apps/web/src/ui/styles.ts',
        // 界面组件：通过行为组件测试与实际浏览器验收验证，沿用既有覆盖率边界
        'apps/web/src/**/*.tsx',
        // 从 SSH 组件抽出的交互 Hook：沿用该组件的浏览器验收范围
        'apps/web/src/builtin-plugins/ssh-console/ssh/use-ssh-connection.ts',
        // 浏览器 WebSocket 封装，逻辑交给 partysocket；状态处理在 chat-store 中测试
        'apps/web/src/lib/ws.ts',
      ],
      thresholds: {
        // 全局底线
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
        // 按职责聚合，防止大模块的高分掩盖独立适配器或基础设施退步。
        'apps/server/src/platform/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        'apps/server/src/agents/claude/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        'apps/server/src/agents/codex/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        'apps/server/src/agents/antigravity/**': { lines: 85, branches: 75, functions: 85, statements: 85 },
        'apps/server/src/agents/common/**': { lines: 85, branches: 75, functions: 85, statements: 85 },
        'apps/server/src/{chat,sessions}/**': { lines: 90, branches: 80, functions: 90, statements: 90 },
        'apps/server/src/plugins/**': { lines: 85, branches: 75, functions: 85, statements: 85 },
        'apps/web/src/cli/**': { lines: 85, branches: 75, functions: 85, statements: 85 },
        // 安全边界：访问控制要求更高
        'apps/server/src/http/security.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
        'packages/shared/src/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
