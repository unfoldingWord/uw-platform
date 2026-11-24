import { describe, expect, it } from 'vitest';
import { cascadeTierSchema, collectionDefinitionSchema } from '@uw/contracts';
import { builtIns } from './seed.ts';

const choices = new Set(['select', 'multi_select', 'status']);
const cascadeWord = /\b(portfolio|program|project|cascade)s?\b/i;
const areaWord = /^[0-9]0-[0-9]9$/;

type Shown = { readonly collection: string; readonly property: string };

function cascadeSelects(): readonly Shown[] {
  return builtIns.flatMap((built) => {
    const definition = collectionDefinitionSchema.parse(built.definition);
    return definition.properties
      .filter((property) => choices.has(property.config.type))
      .filter((property) => {
        const options = 'options' in property.config ? property.config.options : [];
        const named = cascadeWord.test(property.key) || cascadeWord.test(property.name);
        return named || options.some((option) => areaWord.test(option.name));
      })
      .map((property) => ({ collection: definition.key, property: property.key }));
  });
}

describe('#202 no entity carries a cascade coordinate as a plain select', () => {
  it('names a portfolio, program or project only by relation or rollup, never by a select', () => {
    expect(cascadeSelects()).toEqual([]);
  });

  it('would catch a portfolio select planted on a collection', () => {
    for (const tier of cascadeTierSchema.options) expect(cascadeWord.test(tier)).toBe(true);
    expect(cascadeWord.test('Portfolio')).toBe(true);
    expect(cascadeWord.test('programs')).toBe(true);
    expect(cascadeWord.test('phase')).toBe(false);
  });
});
