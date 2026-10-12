import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { id?: string; if?: string; uses?: string; run?: string; env?: Record<string, string> };
type Job = { if?: string; steps: Step[] };

const gateScript = '.github/scripts/secret-gate.sh';
const gateCondition = "steps.gate.outputs.configured == 'true'";
const ingestJobs = [
  ['deploy-staging.yml', 'deploy-ingest-staging'],
  ['deploy-production.yml', 'deploy-ingest-production'],
] as const;

function gateOutput(value: string): string {
  const output = join(mkdtempSync(join(tmpdir(), 'gate-')), 'output');
  writeFileSync(output, '');
  const result = spawnSync('bash', [gateScript, 'CLOUDFLARE_API_TOKEN'], {
    env: { PATH: process.env['PATH'] ?? '', GITHUB_OUTPUT: output, CLOUDFLARE_API_TOKEN: value },
  });
  expect(result.status).toBe(0);
  return readFileSync(output, 'utf8').trim();
}

function jobOf(file: string, name: string): Job {
  const tree: { jobs: Record<string, Job> } = parse(
    readFileSync(join('.github/workflows', file), 'utf8'),
  );
  const job = tree.jobs[name];
  if (!job) throw new Error(`${file} has no job ${name}`);
  return job;
}

describe('FD-10 the secret gate script', () => {
  it('reports configured=false when the variable is empty', () => {
    expect(gateOutput('')).toBe('configured=false');
  });

  it('reports configured=true when the variable is set', () => {
    expect(gateOutput('token')).toBe('configured=true');
  });
});

describe.each(ingestJobs)('FD-10 %s job %s skips cleanly without a secret', (file, name) => {
  const job = jobOf(file, name);
  const gateIndex = job.steps.findIndex((step) => step.id === 'gate');

  it('checks out first, then runs the gate with the secret in that step only', () => {
    expect(job.steps[0]?.uses).toMatch(/^actions\/checkout@/);
    expect(gateIndex).toBe(1);
    expect(job.steps[gateIndex]?.run).toBe(
      'bash .github/scripts/secret-gate.sh CLOUDFLARE_API_TOKEN',
    );
    expect(Object.keys(job.steps[gateIndex]?.env ?? {})).toEqual(['CLOUDFLARE_API_TOKEN']);
  });

  it('guards every later step and reads no secret in a job-level condition', () => {
    const later = job.steps.slice(gateIndex + 1);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((step) => step.if === gateCondition)).toBe(true);
    expect(job.if ?? '').not.toContain('secrets');
  });
});
