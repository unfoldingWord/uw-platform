import { describe, expect, it } from 'vitest';
import manifest from './package.json' with { type: 'json' };

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies'];

describe('@uw/harness wiring', () => {
  it('depends only on workspace packages, so it runs in plain Node', () => {
    const fields: Record<string, unknown> = manifest;
    const names = dependencyFields.flatMap((field) => Object.keys(Object(fields[field])));
    expect(names.filter((name) => !name.startsWith('@uw/'))).toEqual([]);
  });
});
