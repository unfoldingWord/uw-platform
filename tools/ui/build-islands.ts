import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const generated = new URL('../../apps/uw-app/generated/islands.ts', import.meta.url);
const shared = {
  bundle: true,
  minify: true,
  write: false,
  legalComments: 'none',
  target: 'es2022',
  logLevel: 'silent',
} as const;

async function bundled(entry: string, format: 'esm' | 'iife'): Promise<string> {
  const result = await build({ ...shared, entryPoints: [entry], format });
  return result.outputFiles[0]?.text ?? '';
}

function hashedPath(js: string): string {
  return `/assets/islands-${createHash('sha256').update(js).digest('hex').slice(0, 12)}.js`;
}

async function moduleText(): Promise<string> {
  const islandsJs = await bundled('apps/uw-app/islands/browser/main.ts', 'esm');
  const serviceWorkerJs = await bundled('apps/uw-app/islands/worker/sw.ts', 'iife');
  return [
    `export const islandsPath = ${JSON.stringify(hashedPath(islandsJs))};`,
    `export const islandsJs = ${JSON.stringify(islandsJs)};`,
    `export const serviceWorkerJs = ${JSON.stringify(serviceWorkerJs)};`,
    '',
  ].join('\n');
}

const expected = await moduleText();

if (process.argv.includes('--check')) {
  const committed = existsSync(generated) ? readFileSync(generated, 'utf8') : '';
  if (committed !== expected) {
    console.error('apps/uw-app/generated/islands.ts is stale. Run pnpm ui:islands and commit it.');
    process.exit(1);
  }
  console.log('apps/uw-app/generated/islands.ts is the current islands build.');
} else {
  writeFileSync(generated, expected);
  console.log('Wrote apps/uw-app/generated/islands.ts.');
}
