import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../packages/ui/assets/uw-logo-mark.png', import.meta.url);
const target = new URL('../../packages/ui/generated/mark.ts', import.meta.url);

const bytes = readFileSync(source);
const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
const expected = [
  `export const markPath = '/assets/uw-logo-mark-${hash}.png';`,
  `export const markBase64 = '${bytes.toString('base64')}';`,
  '',
].join('\n');

if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== expected) {
    console.error('packages/ui/generated/mark.ts is stale. Run pnpm ui:mark and commit it.');
    process.exit(1);
  }
  console.log('packages/ui/generated/mark.ts is the current mark.');
} else {
  writeFileSync(target, expected);
  console.log('Wrote packages/ui/generated/mark.ts.');
}
