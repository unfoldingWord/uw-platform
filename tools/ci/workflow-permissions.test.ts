import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const directory = '.github/workflows';
const workflows = readdirSync(directory).filter((name) => name.endsWith('.yml'));

type Permissions = unknown;

function permissionsIn(name: string): Permissions[] {
  const workflow: unknown = parse(readFileSync(join(directory, name), 'utf8'));
  if (typeof workflow !== 'object' || workflow === null) return [undefined];
  const top = 'permissions' in workflow ? workflow.permissions : undefined;
  const jobs = 'jobs' in workflow && typeof workflow.jobs === 'object' ? workflow.jobs : null;
  const perJob = Object.values(jobs ?? {}).flatMap((job: unknown) =>
    typeof job === 'object' && job !== null && 'permissions' in job ? [job.permissions] : [],
  );
  return [top, ...perJob];
}

function grantsCheckWrites(permissions: Permissions): boolean {
  if (permissions === 'write-all') return true;
  return typeof permissions === 'object' && permissions !== null && 'checks' in permissions
    ? permissions.checks === 'write'
    : false;
}

describe('no workflow token can write check runs', () => {
  it('finds the workflows', () => {
    expect(workflows).toContain('ci.yml');
  });

  it.each(workflows)('%s sets its token permissions and grants no checks: write', (name) => {
    const [top, ...jobs] = permissionsIn(name);
    expect(top).toBeTypeOf('object');
    expect([top, ...jobs].filter(grantsCheckWrites)).toEqual([]);
  });
});
