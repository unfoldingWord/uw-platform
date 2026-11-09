import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type Face = { readonly family: string; readonly weight: number; readonly file: string };

const fontsource = new URL('../../packages/ui/node_modules/@fontsource/', import.meta.url);
const faces: readonly Face[] = [
  {
    family: 'Nunito Sans',
    weight: 400,
    file: 'nunito-sans/files/nunito-sans-latin-400-normal.woff2',
  },
  {
    family: 'Nunito Sans',
    weight: 600,
    file: 'nunito-sans/files/nunito-sans-latin-600-normal.woff2',
  },
  {
    family: 'Nunito Sans',
    weight: 800,
    file: 'nunito-sans/files/nunito-sans-latin-800-normal.woff2',
  },
  {
    family: 'JetBrains Mono',
    weight: 400,
    file: 'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
  },
];

const moduleTarget = new URL('../../packages/ui/generated/fonts.ts', import.meta.url);
const cssTarget = new URL('../../packages/ui/generated/fonts.css', import.meta.url);

function served(face: Face): { path: string; base64: string; face: Face } {
  const bytes = readFileSync(new URL(face.file, fontsource));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const slug = face.family.toLowerCase().replace(/\s+/g, '-');
  return {
    path: `/assets/fonts/${slug}-${face.weight}-${hash}.woff2`,
    base64: bytes.toString('base64'),
    face,
  };
}

const fonts = faces.map(served);

const moduleText = [
  'export const fontFiles: ReadonlyArray<{ readonly path: string; readonly base64: string }> = [',
  ...fonts.map((font) => `  { path: '${font.path}', base64: '${font.base64}' },`),
  '];',
  '',
].join('\n');

const cssText = fonts
  .map((font) =>
    [
      '@font-face {',
      `  font-family: '${font.face.family}';`,
      '  font-style: normal;',
      `  font-weight: ${font.face.weight};`,
      '  font-display: swap;',
      `  src: url('${font.path}') format('woff2');`,
      '}',
      '',
    ].join('\n'),
  )
  .join('\n');

const targets: ReadonlyArray<readonly [URL, string]> = [
  [moduleTarget, moduleText],
  [cssTarget, cssText],
];

if (process.argv.includes('--check')) {
  const stale = targets.filter(
    ([url, text]) => !existsSync(url) || readFileSync(url, 'utf8') !== text,
  );
  if (stale.length > 0) {
    console.error('packages/ui/generated/fonts.* is stale. Run pnpm ui:fonts and commit it.');
    process.exit(1);
  }
  console.log('packages/ui/generated/fonts.* is the current font build.');
} else {
  for (const [url, text] of targets) writeFileSync(url, text);
  console.log('Wrote packages/ui/generated/fonts.ts and fonts.css.');
}
