// 代码检查：TypeScript 类型规则 + 复杂度限制；格式交给 Prettier（eslint-config-prettier 关闭冲突规则）
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      'release/**',
      '.agents/**',
      '.claude/**',
      '.pi/**',
      '**/.superpowers/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    plugins: { sonarjs },
    rules: {
      // 复杂度门槛见 docs/guides/dev-environment.md 1.3
      complexity: ['error', 10],
      'sonarjs/cognitive-complexity': ['error', 15],
      'max-depth': ['error', 4],
      'max-params': ['error', 4],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // 用 void 显式丢弃 Promise 是有意为之
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },

  // 目录迁移后的依赖方向：底层和 CLI 不反向依赖业务服务。
  {
    files: ['apps/server/src/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(agents|chat|sessions|settings|workspaces|plugins|builtin-plugins|http|bootstrap)(/|$)',
              message: '平台模块不得依赖应用、CLI 或插件业务。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/agents/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\..*/(chat|sessions|settings|plugins|builtin-plugins|http|bootstrap)/',
              message: 'CLI 适配器只依赖契约、公共适配工具和平台模块。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/plugins/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(agents|chat|sessions|settings|workspaces|builtin-plugins|bootstrap)(/|$)',
              message: '插件宿主通过注册接口接收业务，不直接导入业务实现。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/cli/**/*.{ts,tsx}', 'apps/web/src/lib/**/*.{ts,tsx}', 'apps/web/src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(features|builtin-plugins|app)(/|$)',
              message: '公共前端模块不得反向依赖功能页面或插件业务。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '(^|/)(apps|scripts)(/|$)', message: '共享契约不得反向依赖应用实现。' }] },
      ],
    },
  },

  // 前端：浏览器环境 + React Hooks 规则
  {
    files: ['apps/web/{src,tests}/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // zustand 的 action 是箭头函数，从 selector 取出后单独调用不会丢失 this
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // 测试：允许为构造场景使用 any、非空断言与较长的用例
  {
    files: ['apps/*/tests/**/*.{ts,tsx}', 'packages/*/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      'sonarjs/cognitive-complexity': 'off',
      // expect(mock.fn).toHaveBeenCalled() 这类断言不会调用方法
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // 配置文件不在任何 tsconfig 中，不做类型检查
  {
    files: ['*.config.{js,ts}', 'apps/*/*.config.ts', 'packages/*/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
