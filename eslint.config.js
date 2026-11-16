import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist', 'src-tauri/target', 'src-tauri/gen', 'docs/prototype', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 插件 7.x 的 configs.flat 才是扁平配置形态，顶层同名入口仍是旧结构。
  reactHooks.configs.flat['recommended-latest'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      // 未使用变量允许下划线前缀，便于保留接口签名。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
