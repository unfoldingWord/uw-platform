import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const assets = [
  { name: 'mark', file: 'uw-logo-mark', served: true },
  { name: 'wordmark', file: 'uw-logo-white', served: true },
  { name: 'markWhite', file: 'uw-logo-mark-white', served: false },
] as const;
const target = new URL('../../packages/ui/generated/mark.ts', import.meta.url);

function linesFor(asset: (typeof assets)[number]): readonly string[] {
  const bytes = readFileSync(
    new URL(`../../packages/ui/assets/${asset.file}.png`, import.meta.url),
  );
  const inlined = `export const ${asset.name}Base64 = '${bytes.toString('base64')}';`;
  if (!asset.served) return [inlined];
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return [`export const ${asset.name}Path = '/assets/${asset.file}-${hash}.png';`, inlined];
}

const expected = [...assets.flatMap(linesFor), ''].join('\n');

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
