import { capabilityWordSchema, stageBracketSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { capabilityReaches } from './capability.ts';

function reached(capability: (typeof capabilityWordSchema.options)[number]): readonly string[] {
  return stageBracketSchema.options.filter((bracket) => capabilityReaches(capability, bracket));
}

describe('capability brackets', () => {
  it('build and review reach the build package, iterate reaches iterate, none reaches nothing', () => {
    expect(reached('build')).toEqual(['build_package']);
    expect(reached('review')).toEqual(['build_package']);
    expect(reached('iterate')).toEqual(['iterate']);
    expect(reached('none')).toEqual([]);
  });
});
