import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockAt, cssBlocks, referencedToken, tokenFile } from './css-tokens.ts';

const themeContexts = new Set(['@theme', '@theme inline']);

function definedTokens(): Map<string, string> {
  const names = readdirSync('packages/ui/tokens').filter((file) => file.endsWith('.css'));
  return new Map(
    names.flatMap((file) =>
      tokenFile(file.replace(/\.css$/, '')).flatMap((block) => [...block.declarations]),
    ),
  );
}

function themeDeclarations(css: string): [string, string][] {
  return cssBlocks(css)
    .filter((block) => themeContexts.has(block.context))
    .flatMap((block) => [...block.declarations]);
}

function themeValueViolations(css: string, tokens: ReadonlyMap<string, string>): string[] {
  return themeDeclarations(css)
    .filter(([, value]) => value !== 'initial')
    .filter(([name, value]) => {
      const referenced = referencedToken(value);
      if (referenced !== undefined)
        return !referenced.startsWith('--uw-') || !tokens.has(referenced);
      return tokens.get(`--uw-${name.slice(2)}`) !== value;
    })
    .map(([name, value]) => `${name}: ${value}`);
}

function coloursWithoutTheme(semantic: Iterable<string>, css: string): string[] {
  const theme = new Set(themeDeclarations(css).map(([name]) => name));
  return [...semantic].filter(
    (name) => name.startsWith('--uw-') && !theme.has(`--color-${name.slice('--uw-'.length)}`),
  );
}

const appCss = (): string => readFileSync('packages/ui/app.css', 'utf8');
const semanticColours = (): string[] => [...blockAt(tokenFile('theme'), ':root').keys()];

describe('WB-11 the Tailwind theme is the tokens and nothing else', () => {
  it('WB-11 every theme value is a token', () => {
    expect(themeDeclarations(appCss()).length).toBeGreaterThan(0);
    expect(themeValueViolations(appCss(), definedTokens())).toEqual([]);
  });

  it('WB-11 every semantic colour token has a theme colour', () => {
    expect(coloursWithoutTheme(semanticColours(), appCss())).toEqual([]);
  });

  it('WB-11 flags a planted theme value that is not a token, and a planted token with no theme colour', () => {
    const planted = `${appCss()}\n@theme inline { --color-alarm: #ff0000; --color-ghost: var(--uw-ghost); --breakpoint-xl: 90rem; }\n`;
    expect(themeValueViolations(planted, definedTokens())).toEqual([
      '--color-alarm: #ff0000',
      '--color-ghost: var(--uw-ghost)',
      '--breakpoint-xl: 90rem',
    ]);
    expect(coloursWithoutTheme([...semanticColours(), '--uw-planted'], appCss())).toEqual([
      '--uw-planted',
    ]);
  });
});
