import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/android/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['*.{js,mjs}', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'tests/**/*.ts',
      'playwright.config.ts',
      'vitest.config.ts',
      '**/vite.config.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
