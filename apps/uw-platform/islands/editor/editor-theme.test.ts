import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function crepeThemeVariables(): readonly string[] {
  const theme = readFileSync(require.resolve('@milkdown/crepe/theme/classic.css'), 'utf8');
  return [...new Set([...theme.matchAll(/(--crepe-[a-z0-9-]+)\s*:/gu)].map((match) => match[1]))]
    .filter((name): name is string => name !== undefined)
    .sort();
}

function ourSettings(): ReadonlyMap<string, string> {
  const css = readFileSync('apps/uw-platform/islands/editor/editor.css', 'utf8');
  return new Map(
    [...css.matchAll(/(--crepe-[a-z0-9-]+)\s*:\s*([^;]+);/gu)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  );
}

describe('the page editor wears the platform tokens, not the editor kit’s own palette', () => {
  it('sets every colour, font and shadow the editor kit’s theme declares from a token', () => {
    const settings = ourSettings();
    const declared = crepeThemeVariables();
    expect(declared.length).toBeGreaterThan(10);
    const unset = declared.filter((name) => !settings.has(name));
    expect(unset).toEqual([]);
    const offScale = [...settings].filter(([, value]) => !/^var\(--uw-[a-z0-9-]+\)$/u.test(value));
    expect(offScale).toEqual([]);
  });
});
