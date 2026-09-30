import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const workerPackages = ['apps/uw-app', 'apps/uw-ingest'];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            miniflare: { compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'] },
          }),
        ],
        test: {
          name: 'workers',
          include: workerPackages.map((path) => `${path}/**/*.test.ts`),
        },
      },
      {
        test: {
          name: 'node',
          include: ['packages/**/*.test.ts', 'tools/**/*.test.ts', 'sim/**/*.test.ts'],
        },
      },
    ],
  },
});
