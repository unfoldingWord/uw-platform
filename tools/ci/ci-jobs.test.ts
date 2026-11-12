import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ciJobSchema } from '../../packages/contracts/ship-rule.ts';

type Job = {
  needs?: string[];
  if?: string;
  strategy?: { matrix?: { part?: (number | string)[] } };
};

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const shardJob = 'test-shard';
const releaseSource = 'release-source';

describe('KN-11 the six jobs the ship rule reads are the CI job names', () => {
  it('keys the workflow jobs by the ciJobSchema names, in order, plus the test shards', () => {
    const helpers = new Set([shardJob, releaseSource]);
    const named = Object.keys(workflow.jobs).filter((name) => !helpers.has(name));
    expect(named).toEqual(ciJobSchema.options);
  });

  it('runs the tests on six shards and the scenarios beside them, and test passes only when every part did', () => {
    expect(workflow.jobs[shardJob]?.strategy?.matrix?.part).toEqual([1, 2, 3, 4, 5, 6, 'sim']);
    const gate = workflow.jobs['test'];
    expect(gate?.needs).toEqual([shardJob]);
    expect(gate?.if).toBe('always()');
    expect(JSON.stringify(gate)).toContain('needs.test-shard.result');
  });
});

describe('the develop → main branching model', () => {
  it('refuses a PR into main from anything but develop, with no hotfix exception', () => {
    const job = workflow.jobs['release-source'];
    const text = JSON.stringify(job);
    expect(job?.if).toBe("${{ github.event_name == 'pull_request' && github.base_ref == 'main' }}");
    expect(text).not.toContain('hotfix');
    expect(text).toContain('HEAD_REF');
    const run = (job as { steps?: { run?: string }[] } | undefined)?.steps?.[0]?.run ?? '';
    expect(run).not.toContain('${{');
    expect(run).toContain('"$head" != "develop"');
  });
});
