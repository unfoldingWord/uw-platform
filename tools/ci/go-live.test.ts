import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = { id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string> };
type Job = { if?: string; needs?: string[]; steps?: Step[] };

function job(file: string, id: string): Job {
  const workflow: { jobs: Record<string, Job> } = parse(
    readFileSync(join('.github/workflows', file), 'utf8'),
  );
  return workflow.jobs[id] ?? {};
}

function runGate(env: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'uw-gate-'));
  const output = join(dir, 'output');
  try {
    execFileSync('bash', ['.github/scripts/secret-gate.sh', 'PROBE_SECRET'], {
      env: { PATH: process.env['PATH'] ?? '', GITHUB_OUTPUT: output, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const goLiveJobs: [string, string, string][] = [
  ['neon-pr.yml', 'neon-branch', 'NEON_API_KEY'],
  ['cleanup-pr.yml', 'drop-neon-branch', 'NEON_API_KEY'],
  ['deploy-staging.yml', 'migrate-staging', 'NEON_DIRECT_URL_STAGING'],
  ['deploy-production.yml', 'migrate-production', 'NEON_DIRECT_URL_PRODUCTION'],
];

const gated = "steps.gate.outputs.configured == 'true'";

function mentionsSecret(step: Step): boolean {
  return JSON.stringify(step).includes('secrets');
}

function everyStepAfterGateIsGated(steps: Step[]): boolean {
  const gateIndex = steps.findIndex((step) => step.id === 'gate');
  return steps.slice(gateIndex + 1).every((step) => step.if === gated);
}

function noStepBeforeGateReadsASecret(steps: Step[]): boolean {
  const gateIndex = steps.findIndex((step) => step.id === 'gate');
  return steps.slice(0, gateIndex).every((step) => !mentionsSecret(step));
}

describe('FD-12 the go-live jobs skip cleanly while their secret is absent', () => {
  it('reports not configured, and exits 0, when the secret is absent', () => {
    expect(runGate({})).toBe('configured=false\n');
  });

  it('reports configured when the secret is present', () => {
    expect(runGate({ PROBE_SECRET: 'x' })).toBe('configured=true\n');
  });

  it.each(goLiveJobs)('%s %s gates every go-live step on %s', (file, id, secret) => {
    const steps = job(file, id).steps ?? [];
    const gate = steps.find((step) => step.id === 'gate');
    expect(gate?.run).toBe(`bash .github/scripts/secret-gate.sh ${secret}`);
    expect(Object.keys(gate?.env ?? {})).toEqual([secret]);
    expect(everyStepAfterGateIsGated(steps)).toBe(true);
    expect(noStepBeforeGateReadsASecret(steps)).toBe(true);
    expect(job(file, id).if ?? '').not.toMatch(/secrets/);
  });

  it('migrates before it deploys', () => {
    expect(job('deploy-staging.yml', 'deploy-staging').needs).toEqual(['migrate-staging']);
    expect(job('deploy-staging.yml', 'deploy-ingest-staging').needs).toEqual(['migrate-staging']);
    expect(job('deploy-production.yml', 'deploy-production').needs).toEqual([
      'production-gate',
      'migrate-production',
    ]);
    expect(job('deploy-production.yml', 'deploy-ingest-production').needs).toEqual([
      'production-gate',
      'migrate-production',
    ]);
  });
});

describe('P13 per-PR Workers deploy to the preview environment', () => {
  it('deploys the PR bundle with --env preview and never --env staging', () => {
    const steps = job('deploy-pr.yml', 'deploy-pr').steps ?? [];
    const deploy = steps.find((step) => step.run?.includes('wrangler deploy'));
    expect(deploy?.run).toContain('--env preview');
    expect(deploy?.run).not.toContain('--env staging');
  });
});

describe('P33 the PR Neon branch is migrated by main tooling from the PR migrations as data', () => {
  it('replaces main migrations with the PR migrations before running main runner', () => {
    const steps = job('neon-pr.yml', 'neon-branch').steps ?? [];
    const runs = steps.map((step) => step.run ?? '');
    const copyIndex = runs.findIndex((run) => run.includes('pr/packages/db/migrations'));
    const migrateIndexes = runs.flatMap((run, index) =>
      run.includes('packages/db/bin/migrate.ts') ? [index] : [],
    );
    expect(copyIndex).toBeGreaterThan(-1);
    expect(migrateIndexes).toHaveLength(2);
    expect(migrateIndexes.every((index) => index > copyIndex)).toBe(true);
  });
});
