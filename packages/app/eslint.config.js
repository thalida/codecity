// eslint.config.js — flat config (ESLint 9+).
// Loose during the JS→TS migration: typescript-eslint/recommended only.
// Once every file is .ts, swap recommended → strictTypeChecked +
// stylisticTypeChecked and enable parserOptions.project — see plan.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import css from '@eslint/css';
import house from './eslint-rules/index.js';
import importX from 'eslint-plugin-import-x';

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
  {
    // Scoped, so the JS rules aren't handed a stylesheet: the CSS language has
    // no getAllComments, and core rules crash reaching for it.
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    plugins: { house, 'import-x': importX },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // On here so an editor flags it as you type. The whole-tree `npm run
      // lint` switches it off; the pre-push gate runs it over changed files.
      'house/comment-length': ['error', { max: 2, header: 4 }],
      'house/tip-length': ['error', { max: 160 }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      // ES6+ modernization (autofix-able)
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-object-has-own': 'error',
      'no-useless-concat': 'error',
      // One statement per module: a value import and a type import from the
      // same place read as two dependencies when they are one.
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
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
  },
  {
    files: ['**/*.css'],
    language: 'css/css',
    plugins: { css, house },
    rules: { 'house/css-comment-length': ['error', { max: 2, header: 4 }] },
  }
);
