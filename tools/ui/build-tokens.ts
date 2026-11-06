import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { scalesCss } from './scales.ts';

const target = new URL('../../packages/ui/tokens/scales.css', import.meta.url);
const expected = scalesCss();

if (process.argv.includes('--check')) {
  const committed = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (committed !== expected) {
    console.error('packages/ui/tokens/scales.css is stale. Run pnpm ui:tokens and commit it.');
    process.exit(1);
  }
  console.log('packages/ui/tokens/scales.css is the generated scales.');
} else {
  writeFileSync(target, expected);
  console.log('Wrote packages/ui/tokens/scales.css.');
}
