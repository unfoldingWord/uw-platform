import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const scriptHex = /['"`]\s*#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const sheetHex = /#[0-9a-fA-F]{3,8}\b/;
const colourFunction = /\b(?:rgba?|hsla?|oklch)\(/;

const tokenHomes = [/^packages\/ui\/tokens\/[^/]+\.css$/, /^packages\/ui\/generated\/app-css\.ts$/];

function scanned(path: string): boolean {
  return (
    /^(apps|packages)\//.test(path) &&
    /\.(ts|tsx|css|html)$/.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !tokenHomes.some((home) => home.test(path))
  );
}

function hasColourLiteral(path: string, text: string): boolean {
  const hex = /\.tsx?$/.test(path) ? scriptHex : sheetHex;
  return hex.test(text) || colourFunction.test(text);
}

describe('WB-11 tokens are the only source of a colour', () => {
  it('WB-11 no hex colour or colour function outside the token files', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .filter((path) => hasColourLiteral(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('WB-11 flags a planted hex colour in a component and in a stylesheet', () => {
    expect(scanned('packages/ui/components/card.tsx')).toBe(true);
    expect(scanned('packages/ui/app.css')).toBe(true);
    expect(hasColourLiteral('packages/ui/components/card.tsx', `style={{ color: '#e00' }}`)).toBe(
      true,
    );
    expect(hasColourLiteral('apps/uw-app/x.ts', `const alarm = '#ff0000';`)).toBe(true);
    expect(hasColourLiteral('packages/ui/app.css', 'a { color: #f00; }')).toBe(true);
    expect(hasColourLiteral('packages/ui/app.css', 'a { color: rgb(255 0 0); }')).toBe(true);
    expect(hasColourLiteral('apps/uw-app/x.tsx', 'oklch(0.6 0.2 30)')).toBe(true);
    expect(hasColourLiteral('apps/uw-app/x.tsx', `<a href="#main">`)).toBe(false);
    expect(scanned('packages/ui/tokens/theme.css')).toBe(false);
    expect(scanned('packages/ui/generated/app-css.ts')).toBe(false);
  });
});
