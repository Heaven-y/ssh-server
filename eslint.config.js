// 代码检查：TypeScript 类型规则 + 复杂度限制；格式交给 Prettier（eslint-config-prettier 关闭冲突规则）
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.agents/**', '.claude/**', '.pi/**'] },

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

  // 前端：浏览器环境 + React Hooks 规则
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
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
    files: ['**/*.test.ts', '**/*.test.tsx'],
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
    files: ['*.config.{js,ts}', 'apps/*/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
