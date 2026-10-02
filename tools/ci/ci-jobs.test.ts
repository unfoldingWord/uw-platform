import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ciJobSchema } from '../../packages/contracts/ship-rule.ts';

describe('KN-11 the six jobs the ship rule reads are the CI job names', () => {
  it('keys the workflow jobs by the ciJobSchema names, in order', () => {
    const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
      jobs: Record<string, unknown>;
    };
    expect(Object.keys(workflow.jobs)).toEqual(ciJobSchema.options);
  });
});
