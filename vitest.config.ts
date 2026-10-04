import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const workerPackages = ['apps/uw-app', 'apps/uw-ingest'];

const sdkWithoutSourcemaps = {
  name: 'mcp-sdk-without-sourcemaps',
  enforce: 'pre' as const,
  async load(id: string) {
    if (!id.includes('/@modelcontextprotocol/sdk/dist/')) return null;
    const code = await readFile(id.split('?')[0] ?? id, 'utf8');
    return { code: code.replace(/^\/\/# sourceMappingURL=.*$/gm, ''), map: null };
  },
};

export default defineConfig({
  test: {
    maxWorkers: Math.min(6, availableParallelism()),
    projects: [
      {
        plugins: [
          sdkWithoutSourcemaps,
          cloudflareTest({
            miniflare: { compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'] },
          }),
        ],
        test: {
          name: 'workers',
          include: workerPackages.map((path) => `${path}/**/*.test.ts`),
          exclude: [
            '**/*.pg.test.ts',
            '**/node_modules/**',
            'apps/uw-app/islands/browser/**',
            'apps/uw-app/islands/worker/**',
          ],
        },
      },
      {
        test: {
          name: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
          include: [
            'packages/**/*.test.ts',
            'tools/**/*.test.ts',
            'sim/**/*.test.ts',
            'apps/**/*.pg.test.ts',
            'apps/uw-app/islands/browser/**/*.test.ts',
            'apps/uw-app/islands/worker/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
