import { describe, expect, it } from 'vitest';
import manifest from './package.json' with { type: 'json' };

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies'];

describe('@uw/contracts wiring', () => {
  it('depends on no other workspace package', () => {
    const fields: Record<string, unknown> = manifest;
    const names = dependencyFields.flatMap((field) => Object.keys(Object(fields[field])));
    expect(names.filter((name) => name.startsWith('@uw/'))).toEqual([]);
  });
});
