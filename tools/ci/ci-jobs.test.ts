import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ciJobSchema } from '../../packages/contracts/ship-rule.ts';

type Job = { needs?: string[]; if?: string; strategy?: { matrix?: { shard?: number[] } } };

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const shardJob = 'test-shard';

describe('KN-11 the six jobs the ship rule reads are the CI job names', () => {
  it('keys the workflow jobs by the ciJobSchema names, in order, plus the test shards', () => {
    const named = Object.keys(workflow.jobs).filter((name) => name !== shardJob);
    expect(named).toEqual(ciJobSchema.options);
  });

  it('runs the tests on four shards, and test passes only when every shard did', () => {
    expect(workflow.jobs[shardJob]?.strategy?.matrix?.shard).toEqual([1, 2, 3, 4]);
    const gate = workflow.jobs['test'];
    expect(gate?.needs).toEqual([shardJob]);
    expect(gate?.if).toBe('always()');
    expect(JSON.stringify(gate)).toContain('needs.test-shard.result');
  });
});
