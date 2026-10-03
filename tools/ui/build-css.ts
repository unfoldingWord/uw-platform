import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const input = fileURLToPath(new URL('../../packages/ui/app.css', import.meta.url));
const generated = new URL('../../packages/ui/generated/app-css.ts', import.meta.url);

async function buildStylesheet(): Promise<string> {
  const base = path.dirname(input);
  const compiler = await compile(readFileSync(input, 'utf8'), {
    from: input,
    base,
    onDependency: () => undefined,
  });
  const root = compiler.root;
  const sources = [
    ...(root === 'none'
      ? []
      : root === null
        ? [{ base, pattern: '**/*', negated: false }]
        : [{ ...root, negated: false }]),
    ...compiler.sources,
    {
      base: path.dirname(process.execPath),
      pattern: path.basename(process.execPath),
      negated: true,
    },
    { base, pattern: path.basename(input), negated: false },
  ];
  const candidates = new Scanner({ sources }).scan();
  return optimize(compiler.build(candidates), { file: 'app.css', minify: true }).code;
}

function moduleFor(css: string): string {
  const hash = createHash('sha256').update(css).digest('hex').slice(0, 12);
  return [
    `export const appCssPath = '/assets/app-${hash}.css';`,
    `export const appCss = ${JSON.stringify(css)};`,
    '',
  ].join('\n');
}

const expected = moduleFor(await buildStylesheet());

if (process.argv.includes('--check')) {
  const committed = existsSync(generated) ? readFileSync(generated, 'utf8') : '';
  if (committed !== expected) {
    console.error('packages/ui/generated/app-css.ts is stale. Run pnpm ui:css and commit it.');
    process.exit(1);
  }
  console.log('packages/ui/generated/app-css.ts is the current Tailwind build.');
} else {
  writeFileSync(generated, expected);
  console.log('Wrote packages/ui/generated/app-css.ts.');
}
