import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { personasOf } from '../../packages/harness/templates/personas.ts';

const correction = readFileSync(
  'packages/db/migrations/0070_persona_stock_verdict_text.sql',
  'utf8',
);
const literals = [...correction.matchAll(/'((?:End|Open) your [^']+)'/g)].map((match) => match[1]);
const replaced = [...new Set(literals.filter((text) => text?.startsWith('End')))];
const replacements = [...new Set(literals.filter((text) => text?.startsWith('Open')))];
const stock = (['software', 'bml'] as const)
  .flatMap((template) => personasOf(template))
  .map((persona) => persona.bodyMd);

describe('PE-5 the stored persona correction and the stock personas say the same thing', () => {
  it('reads two old sentences and two new ones from the migration', () => {
    expect(replaced).toHaveLength(2);
    expect(replacements).toHaveLength(2);
  });

  it.each(replacements)('a stock persona carries the corrected sentence: %s', (sentence) => {
    expect(stock.some((body) => body.includes(sentence ?? '\0'))).toBe(true);
  });

  it.each(replaced)('no stock persona still carries the old sentence: %s', (sentence) => {
    expect(stock.some((body) => body.includes(sentence ?? '\0'))).toBe(false);
  });
});
