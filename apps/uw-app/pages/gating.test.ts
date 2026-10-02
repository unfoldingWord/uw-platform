import { describe, expect, it } from 'vitest';
import { pageTypes } from '@uw/contracts';
import { gatingOf } from './gating.ts';

describe('AB-5 every page type is classified as gated or open', () => {
  it('classifies each member of pageTypes, so a new type fails until it is classified', () => {
    expect(pageTypes.map((type) => [type, gatingOf(type)])).toEqual([
      ['skill', 'gated'],
      ['learning', 'gated'],
      ['persona', 'gated'],
      ['product', 'open'],
      ['system_goal', 'open'],
      ['product_strategy', 'open'],
      ['data_sources', 'open'],
    ]);
  });

  it('has no policy type to gate in v1', () => {
    expect(pageTypes).not.toContain('policy');
  });
});
