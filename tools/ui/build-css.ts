import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const builtCss = new URL('../../packages/ui/dist/app.css', import.meta.url);
const generated = new URL('../../packages/ui/generated/app-css.ts', import.meta.url);

function buildStylesheet(): string {
  execFileSync('pnpm', ['--filter', '@uw/ui', '--silent', 'run', 'css'], {
    cwd: root,
    stdio: 'pipe',
  });
  return readFileSync(builtCss, 'utf8');
}

function moduleFor(css: string): string {
  const hash = createHash('sha256').update(css).digest('hex').slice(0, 12);
  return [
    `export const appCssPath = '/assets/app-${hash}.css';`,
    `export const appCss = ${JSON.stringify(css)};`,
    '',
  ].join('\n');
}

const expected = moduleFor(buildStylesheet());

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
