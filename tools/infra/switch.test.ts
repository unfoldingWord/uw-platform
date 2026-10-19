import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseSwitch } from './switch.ts';

type Step = {
  readonly id?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
};
type Job = {
  readonly if?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly steps?: readonly Step[];
};
type Block = Record<string, unknown>;
type Located = { readonly site: string; readonly job: Job };

const workflows = '.github/workflows';
const gated = "steps.gate.outputs.configured == 'true'";
const neonName = /\b(?:secrets|vars)\.(NEON_[A-Z_]+)\b/g;
const gateRun = /^bash \.github\/scripts\/secret-gate\.sh ([A-Z_]+)$/;
const placeholder = 'set-at-go-live';
const goLiveFiles = ['infra/uw-app/wrangler.go-live.toml', 'infra/uw-ingest/wrangler.go-live.toml'];
const switchHeading = '## Switching on the go-live wiring (FD-12)';
const runbookStep = /^(\d+)\. \*\*/gm;

function jobsIn(file: string): [string, Job][] {
  const text = readFileSync(join(workflows, file), 'utf8');
  const workflow = parseYaml(text) as { readonly jobs?: Record<string, Job> };
  return Object.entries(workflow.jobs ?? {});
}

function neonNames(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(neonName)].map((match) => match[1] ?? '');
}

function neonJobs(): Located[] {
  const files = readdirSync(workflows)
    .filter((file) => file.endsWith('.yml'))
    .sort();
  return files.flatMap((file) =>
    jobsIn(file)
      .filter(([, job]) => neonNames(job).length > 0)
      .map(([id, job]) => ({ site: `${file} ${id}`, job })),
  );
}

function gateSecret(job: Job): string {
  const gate = (job.steps ?? []).find((step) => step.id === 'gate');
  return gateRun.exec(gate?.run ?? '')?.[1] ?? '';
}

function ungatedSteps(job: Job): number[] {
  const steps = job.steps ?? [];
  const gate = steps.findIndex((step) => step.id === 'gate');
  return steps.flatMap((step, index) => {
    const early = index < gate && neonNames(step).length > 0;
    const loose = index > gate && step.if !== gated;
    return early || loose ? [index] : [];
  });
}

function runGate(secret: string, present: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'uw-switch-'));
  const output = join(dir, 'output');
  try {
    const env = {
      PATH: process.env['PATH'] ?? '',
      GITHUB_OUTPUT: output,
      ...(present ? { [secret]: 'set' } : {}),
    };
    execFileSync('bash', ['.github/scripts/secret-gate.sh', secret], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function switchSection(): string {
  const text = readFileSync('infra/README.md', 'utf8');
  const start = text.indexOf(switchHeading);
  return start === -1 ? '' : text.slice(start);
}

function runbookSteps(section: string): number[] {
  return [...section.matchAll(runbookStep)].map((match) => Number(match[1]));
}

function environmentsOf(path: string): Block[] {
  const config = parseToml(readFileSync(path, 'utf8')) as Block;
  return Object.values((config['env'] ?? {}) as Record<string, Block>);
}

function placeholdersIn(block: Block): string[] {
  const vars = Object.entries((block['vars'] ?? {}) as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.includes(placeholder))
    .map(([key]) => key);
  const ids = (block['hyperdrive'] ?? []) as readonly { readonly id?: string }[];
  return ids.some((entry) => entry.id === placeholder) ? [...vars, 'Hyperdrive id'] : vars;
}

function placeholderNames(): string[] {
  return [...new Set(goLiveFiles.flatMap(environmentsOf).flatMap(placeholdersIn))].sort();
}

function stagingProbe(): string {
  const text = readFileSync(join(workflows, 'deploy-staging.yml'), 'utf8');
  const workflow = parseYaml(text) as { readonly jobs: Record<string, Job> };
  return `${workflow.jobs['deploy-staging']?.env?.['STAGING_URL'] ?? ''}/health/probe`;
}

describe('GL-1 every go-live job runs when its secret exists and skips while it is absent', () => {
  it('GL-1 finds every job that reads a Neon secret, each behind a gate on a Neon secret', () => {
    const jobs = neonJobs();
    expect(jobs.map((found) => found.site)).toEqual([
      'cleanup-pr.yml drop-neon-branch',
      'deploy-production.yml migrate-production',
      'deploy-staging.yml migrate-staging',
      'neon-pr.yml neon-branch',
    ]);
    for (const { site, job } of jobs) {
      expect(gateSecret(job), site).toMatch(/^NEON_/);
      expect(ungatedSteps(job), site).toEqual([]);
      expect(neonNames(job.env ?? {}), site).toEqual([]);
      expect(job.if ?? '', site).not.toMatch(/secrets/);
    }
  });

  it('GL-1 the gate opens each job when its secret is set and keeps it green when it is not', () => {
    for (const { job } of neonJobs()) {
      expect(runGate(gateSecret(job), true)).toBe('configured=true\n');
      expect(runGate(gateSecret(job), false)).toBe('configured=false\n');
    }
  });

  it('GL-1 flags a planted job that reads a Neon secret before its gate or runs a step outside it', () => {
    const planted: Job = {
      steps: [
        { run: 'pnpm db:migrate', env: { DATABASE_URL: 'secrets.NEON_DIRECT_URL_STAGING' } },
        { id: 'gate', run: 'bash .github/scripts/secret-gate.sh NEON_DIRECT_URL_STAGING' },
        { run: 'pnpm db:migrate' },
      ],
    };
    expect(gateSecret(planted)).toBe('NEON_DIRECT_URL_STAGING');
    expect(ungatedSteps(planted)).toEqual([0, 2]);
    expect(ungatedSteps({ steps: [{ run: 'pnpm db:migrate' }] })).toEqual([0]);
  });
});

describe('GL-1 the runbook switches on what the go-live files leave unset', () => {
  it('GL-1 names every secret a go-live job reads and every value still set-at-go-live', () => {
    const section = switchSection();
    const secrets = [...new Set(neonJobs().flatMap(({ job }) => neonNames(job)))].sort();
    expect(secrets).toEqual([
      'NEON_API_KEY',
      'NEON_DIRECT_URL_PRODUCTION',
      'NEON_DIRECT_URL_STAGING',
      'NEON_PROJECT_ID',
    ]);
    expect(placeholderNames()).toContain('Hyperdrive id');
    expect([...secrets, ...placeholderNames()].filter((name) => !section.includes(name))).toEqual(
      [],
    );
  });

  it('GL-1 orders the switch in eight steps and ends on the staging probe answering the database through Hyperdrive', () => {
    const section = switchSection();
    expect(runbookSteps(section)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stagingProbe()).toBe('https://uw-app-staging.unfoldingword.workers.dev/health/probe');
    expect(section).toContain(stagingProbe());
    expect(section).toContain('select(.name == "database")');
    expect(section).toContain('reachable in');
    expect(section).toContain('infra/go-live.json');
  });

  it('GL-1 the switch is a boolean in infra/go-live.json and nothing else', () => {
    expect(parseSwitch('{ "switchedOn": false }')).toBe(false);
    expect(parseSwitch('{ "switchedOn": true }')).toBe(true);
    expect(() => parseSwitch('{ "switchedOn": "yes" }')).toThrow('infra/go-live.json');
    expect(() => parseSwitch('{}')).toThrow('infra/go-live.json');
    expect(typeof parseSwitch(readFileSync('infra/go-live.json', 'utf8'))).toBe('boolean');
  });
});
