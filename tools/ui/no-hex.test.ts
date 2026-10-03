import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';
import { carriesStyles, hasColourLiteral, hexColours } from './colour-literals.ts';

const tokenHomes = [/^packages\/ui\/tokens\/[^/]+\.css$/, /^packages\/ui\/generated\/app-css\.ts$/];

function scanned(path: string): boolean {
  return (
    /^(apps|packages)\//.test(path) &&
    /\.(ts|tsx|css|html)$/.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !tokenHomes.some((home) => home.test(path))
  );
}

const component = 'packages/ui/components/card.tsx';
const server = 'apps/uw-app/github/comment.ts';

describe('WB-11 tokens are the only source of a colour', () => {
  it('WB-11 no hex colour or colour function outside the token files', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .filter((path) => hasColourLiteral(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it.each([
    [component, `export const C = () => <p style="color: #e00">x</p>;`],
    [component, `export const C = () => <p style={{ color: '#e00' }}>x</p>;`],
    [component, "export const edge = 'border: 1px solid #fff';"],
    [component, 'export const c = `color: #ff00aa80`;'],
    [component, 'export const c = `a ${b} border-color: #abcd;`;'],
    [component, "export const c = 'color:#123456';"],
    [component, "export const c = 'color: #123';"],
    [server, "export const edge = 'border: 1px solid #fff';"],
    [server, "export const c = 'background: #a1b2c3';"],
    ['packages/ui/app.css', 'a { color: #f00; }'],
    ['packages/ui/app.css', 'a { color: #ff000080; }'],
    ['packages/ui/app.css', 'a { color: rgb(255 0 0); }'],
    ['apps/uw-app/x.tsx', "export const c = 'oklch(0.6 0.2 30)';"],
  ])('WB-11 flags a planted colour in %s: %s', (path, text) => {
    expect(scanned(path)).toBe(true);
    expect(hasColourLiteral(path, text)).toBe(true);
  });

  it.each([
    [component, `export const C = () => <a href="#main">Skip</a>;`],
    [component, 'export const c = `&#123;`;'],
    [server, "export const ref = 'Closes #123';"],
    [server, "export const ref = 'See #1234 and #123456';"],
    [server, 'export const ref = `Refs #${number}`;'],
    [server, 'class Fader { #fade = 1; #add() { return this.#fade; } }'],
  ])('passes a non-colour %s: %s', (path, text) => {
    expect(hexColours(path, text)).toEqual([]);
  });

  it('flags a digits-only hex only where styles are written, since it reads as an issue reference elsewhere', () => {
    expect(carriesStyles(component)).toBe(true);
    expect(carriesStyles('apps/uw-app/islands/live/session.ts')).toBe(true);
    expect(carriesStyles(server)).toBe(false);
    expect(hexColours(component, "export const c = 'see #123';")).toEqual(['#123']);
    expect(hexColours(server, "export const c = 'see #123';")).toEqual([]);
  });

  it('exempts only the token files and the built stylesheet', () => {
    expect(scanned('packages/ui/tokens/theme.css')).toBe(false);
    expect(scanned('packages/ui/generated/app-css.ts')).toBe(false);
    expect(scanned('packages/ui/app.css')).toBe(true);
    expect(scanned('packages/ui/tokens/extra.ts')).toBe(true);
  });
});
