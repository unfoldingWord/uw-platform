import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { build, type Plugin } from 'esbuild';

const generated = new URL('../../apps/uw-platform/generated/islands.ts', import.meta.url);
const generatedEditor = new URL('../../apps/uw-platform/generated/editor.ts', import.meta.url);
const shared = {
  bundle: true,
  minify: true,
  write: false,
  legalComments: 'none',
  target: 'es2022',
  logLevel: 'silent',
} as const;

const englishMessagesOnly: Plugin = {
  name: 'zod-english-messages-only',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]zod[\\/]v4[\\/]locales[\\/]index\.js$/ }, (args) => ({
      contents: "export { default as en } from './en.js';",
      resolveDir: dirname(args.path),
      loader: 'js',
    }));
  },
};

async function bundled(entry: string, format: 'esm' | 'iife'): Promise<string> {
  const result = await build({
    ...shared,
    entryPoints: [entry],
    format,
    plugins: [englishMessagesOnly],
  });
  return result.outputFiles[0]?.text ?? '';
}

function hashedPath(js: string, name = 'islands'): string {
  return `/assets/${name}-${createHash('sha256').update(js).digest('hex').slice(0, 12)}.js`;
}

function hashedCssPath(css: string): string {
  return `/assets/editor-${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`;
}

async function stylesheet(entry: string): Promise<string> {
  const result = await build({ ...shared, entryPoints: [entry], loader: { '.css': 'css' } });
  return result.outputFiles[0]?.text ?? '';
}

async function editorModuleText(): Promise<string> {
  const editorJs = await bundled('apps/uw-platform/islands/editor/main.ts', 'esm');
  const editorCss = await stylesheet('apps/uw-platform/islands/editor/editor.css');
  return [
    `export const editorPath = ${JSON.stringify(hashedPath(editorJs, 'editor'))};`,
    `export const editorJs = ${JSON.stringify(editorJs)};`,
    `export const editorCssPath = ${JSON.stringify(hashedCssPath(editorCss))};`,
    `export const editorCss = ${JSON.stringify(editorCss)};`,
    '',
  ].join('\n');
}

async function moduleText(): Promise<string> {
  const islandsJs = await bundled('apps/uw-platform/islands/browser/main.ts', 'esm');
  const serviceWorkerJs = await bundled('apps/uw-platform/islands/worker/sw.ts', 'iife');
  return [
    `export const islandsPath = ${JSON.stringify(hashedPath(islandsJs))};`,
    `export const islandsJs = ${JSON.stringify(islandsJs)};`,
    `export const serviceWorkerJs = ${JSON.stringify(serviceWorkerJs)};`,
    '',
  ].join('\n');
}

const expected = await moduleText();
const expectedEditor = await editorModuleText();

function committed(file: URL): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

if (process.argv.includes('--check')) {
  if (committed(generated) !== expected || committed(generatedEditor) !== expectedEditor) {
    console.error(
      'apps/uw-platform/generated/islands.ts or editor.ts is stale. Run pnpm ui:islands and commit them.',
    );
    process.exit(1);
  }
  console.log('The committed islands and editor bundles are the current build.');
} else {
  writeFileSync(generated, expected);
  writeFileSync(generatedEditor, expectedEditor);
  console.log('Wrote apps/uw-platform/generated/islands.ts and editor.ts.');
}
