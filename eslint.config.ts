import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import security from 'eslint-plugin-security';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { datesPlugin } from './tools/lint/no-ad-hoc-dates.ts';
import { noCommentsPlugin } from './tools/lint/no-comments.ts';

const uwPlugin = { rules: { ...datesPlugin.rules, ...noCommentsPlugin.rules } };

const sourceFiles = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];
const commentFreeRoots = ['apps/**', 'packages/**', 'sim/**', 'tests/**'];

const vendorSdkPatterns = [
  {
    group: ['@anthropic-ai/*'],
    message: 'Vendor SDKs are imported only inside apps/uw-app/engines/<engine>/.',
  },
  {
    group: ['openai', 'openai/*'],
    message: 'Vendor SDKs are imported only inside apps/uw-app/engines/<engine>/.',
  },
  {
    group: ['@openrouter/*', 'openrouter'],
    message: 'Vendor SDKs are imported only inside apps/uw-app/engines/<engine>/.',
  },
];

const impureImports = [
  'hono',
  'hono/*',
  'drizzle-orm',
  'drizzle-orm/*',
  'wrangler',
  '@cloudflare/*',
  'cloudflare:*',
  '@neondatabase/*',
  'pg',
  'postgres',
  'node:http',
  'node:https',
  'node:http2',
  'node:net',
  'node:tls',
  'node:dns',
  'node:dgram',
];

const networkGlobals = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'WebSocket',
  'XMLHttpRequest',
  'EventSource',
  'caches',
  'navigator',
  'process',
].map((name) => ({
  name,
  message: 'packages/harness is pure TypeScript: reach the world through a port.',
}));

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/.wrangler/**', '**/dist/**', 'prd/**', 'ui-design/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  security.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { uw: uwPlugin },
    rules: {
      'uw/no-ad-hoc-dates': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-restricted-imports': ['error', { patterns: vendorSdkPatterns }],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 25],
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 5],
    },
  },
  {
    files: ['packages/harness/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...vendorSdkPatterns,
            {
              group: impureImports,
              message:
                'packages/harness imports nothing from Workers, Drizzle, a vendor SDK or the network.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...networkGlobals],
    },
  },
  {
    files: ['apps/uw-app/engines/*/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: commentFreeRoots.map((root) => `${root}/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`),
    rules: { 'uw/no-comments': 'error' },
  },
  {
    files: ['tools/**', '**/*.test.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['tools/lint/date-patterns.ts', 'tools/architecture/owners.test.ts'],
    rules: { 'security/detect-non-literal-regexp': 'off' },
  },
  {
    files: ['packages/core/dates.ts', 'tools/lint/date-patterns.ts', 'tools/lint/*.test.ts'],
    rules: { 'uw/no-ad-hoc-dates': 'off' },
  },
  prettier,
]);
