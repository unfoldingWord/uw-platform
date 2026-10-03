import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const directory = '.github/workflows';

function workflowsIn(root: string): string[] {
  return readdirSync(root).filter((name) => /\.ya?ml$/u.test(name));
}

function permissionsIn(path: string): unknown[] {
  const workflow: unknown = parse(readFileSync(path, 'utf8'));
  if (typeof workflow !== 'object' || workflow === null) return [undefined];
  const top = 'permissions' in workflow ? workflow.permissions : undefined;
  const jobs = 'jobs' in workflow && typeof workflow.jobs === 'object' ? workflow.jobs : null;
  const perJob = Object.values(jobs ?? {}).flatMap((job: unknown) =>
    typeof job === 'object' && job !== null && 'permissions' in job ? [job.permissions] : [],
  );
  return [top, ...perJob];
}

function grantsCheckWrites(permissions: unknown): boolean {
  if (permissions === 'write-all') return true;
  return typeof permissions === 'object' && permissions !== null && 'checks' in permissions
    ? permissions.checks === 'write'
    : false;
}

function offending(root: string): string[] {
  return workflowsIn(root).filter((name) => {
    const [top, ...jobs] = permissionsIn(join(root, name));
    return typeof top !== 'object' || [top, ...jobs].some(grantsCheckWrites);
  });
}

describe('no workflow token can write check runs', () => {
  it('finds the workflows', () => {
    expect(workflowsIn(directory)).toContain('ci.yml');
  });

  it.each(workflowsIn(directory))(
    '%s sets its token permissions and grants no checks: write',
    (name) => {
      expect(offending(directory).includes(name)).toBe(false);
    },
  );

  it('checks .yaml workflows as well as .yml', () => {
    const root = mkdtempSync(join(tmpdir(), 'uw-workflows-'));
    try {
      const job = 'jobs:\n  a:\n    runs-on: ubuntu-latest\n';
      writeFileSync(join(root, 'safe.yml'), `permissions:\n  contents: read\n${job}`);
      writeFileSync(join(root, 'forge.yaml'), `permissions:\n  checks: write\n${job}`);
      writeFileSync(join(root, 'bare.yaml'), job);
      writeFileSync(join(root, 'notes.txt'), 'permissions: write-all\n');
      expect(offending(root).sort()).toEqual(['bare.yaml', 'forge.yaml']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
