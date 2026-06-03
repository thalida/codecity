// eslint.config.js — flat config (ESLint 9+).
// Loose during the JS→TS migration: typescript-eslint/recommended only.
// Once every file is .ts, swap recommended → strictTypeChecked +
// stylisticTypeChecked and enable parserOptions.project — see plan.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '../api/static/**',
      'package-lock.json',
      // Auto-generated from the OpenAPI schema by `just gen-types`.
      'src/types/manifest.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      // ES6+ modernization (autofix-able)
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-object-has-own': 'error',
      'no-useless-concat': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['tests/**/*.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  }
);
