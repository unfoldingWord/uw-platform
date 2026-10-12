import { describe, expect, it } from 'vitest';
import { blockAt, themeContexts, tokenFile } from '../../../tools/ui/css-tokens.ts';

const brandGuide = {
  '--uw-brand-inspire': '#31ADE3',
  '--uw-brand-ocean': '#014263',
  '--uw-brand-tech': '#231F20',
  '--uw-brand-cultivate': '#70C9CC',
  '--uw-brand-kindle': '#E59D33',
};

function semanticNames(declarations: ReadonlyMap<string, string>): string[] {
  return [...declarations.keys()].filter((name) => name.startsWith('--uw-')).sort();
}

describe('the brand tokens', () => {
  it("the five brand colours are tokens with the brand guide's values", () => {
    const brand = blockAt(tokenFile('brand'), ':root');
    const values = Object.fromEntries(
      [...brand].map(([name, value]) => [name, value.toUpperCase()]),
    );
    expect(values).toEqual(brandGuide);
  });
});

describe('WB-11 dark mode follows the system setting with a data-theme override', () => {
  it('WB-11 light and dark define the same semantic tokens, and the forced-dark block equals the system-dark block', () => {
    const blocks = tokenFile('theme');
    const light = blockAt(blocks, themeContexts.light);
    const systemDark = blockAt(blocks, themeContexts.systemDark);
    const forcedDark = blockAt(blocks, themeContexts.forcedDark);
    expect(semanticNames(light).length).toBeGreaterThan(0);
    expect(semanticNames(systemDark)).toEqual(semanticNames(light));
    expect(Object.fromEntries(forcedDark)).toEqual(Object.fromEntries(systemDark));
    expect(light.get('color-scheme')).toBe('light');
    expect(systemDark.get('color-scheme')).toBe('dark');
  });
});
