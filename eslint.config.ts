import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { datesPlugin } from './tools/lint/no-ad-hoc-dates.ts';

export default defineConfig([
  { ignores: ['**/node_modules/**', 'prd/**', 'ui-design/**'] },
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { uw: datesPlugin },
    rules: { 'uw/no-ad-hoc-dates': 'error' },
  },
  {
    files: ['packages/core/dates.ts', 'tools/lint/date-patterns.ts', 'tools/lint/*.test.ts'],
    rules: { 'uw/no-ad-hoc-dates': 'off' },
  },
]);
