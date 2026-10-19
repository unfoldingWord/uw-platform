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
const secretName = /\bsecrets\.([A-Z][A-Z0-9_]*)\b/g;
const settingName = /\b(?:secrets|vars)\.([A-Z][A-Z0-9_]*)\b/g;
const issuedByGitHub = 'GITHUB_TOKEN';
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

function namesMatching(value: unknown, pattern: RegExp): string[] {
  return [...JSON.stringify(value).matchAll(pattern)]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== issuedByGitHub);
}

function secretNames(value: unknown): string[] {
  return namesMatching(value, secretName);
}

function secretJobs(): Located[] {
  const files = readdirSync(workflows)
    .filter((file) => file.endsWith('.yml'))
    .sort();
  return files.flatMap((file) =>
    jobsIn(file)
      .filter(([, job]) => secretNames(job).length > 0)
      .map(([id, job]) => ({ site: `${file} ${id}`, job })),
  );
}

function goLiveSettings(): string[] {
  return [...new Set(secretJobs().flatMap(({ job }) => namesMatching(job, settingName)))].sort();
}

function gateFaults(job: Job): string[] {
  const secret = gateSecret(job);
  const faults = secretNames(job).includes(secret) ? [] : [`gate on ${secret || 'nothing'}`];
  const loose = ungatedSteps(job).map((index) => `step ${index}`);
  const early = secretNames(job.env ?? {}).length > 0 ? ['job env'] : [];
  return [...faults, ...loose, ...early];
}

function gateSecret(job: Job): string {
  const gate = (job.steps ?? []).find((step) => step.id === 'gate');
  return gateRun.exec(gate?.run ?? '')?.[1] ?? '';
}

function ungatedSteps(job: Job): number[] {
  const steps = job.steps ?? [];
  const gate = steps.findIndex((step) => step.id === 'gate');
  return steps.flatMap((step, index) => {
    const early = index < gate && secretNames(step).length > 0;
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

function plantedFaultsAreFlagged(): void {
  const planted: Job = {
    steps: [
      { run: 'pnpm db:migrate', env: { DATABASE_URL: 'secrets.NEON_DIRECT_URL_STAGING' } },
      { id: 'gate', run: 'bash .github/scripts/secret-gate.sh NEON_DIRECT_URL_STAGING' },
      { run: 'pnpm db:migrate' },
    ],
  };
  expect(gateSecret(planted)).toBe('NEON_DIRECT_URL_STAGING');
  expect(gateFaults(planted)).toEqual(['step 0', 'step 2']);
  const deploy = { run: 'wrangler deploy', env: { CLOUDFLARE_API_TOKEN: 'secrets.X_TOKEN' } };
  expect(gateFaults({ steps: [deploy] })).toEqual(['gate on nothing', 'step 0']);
  const elsewhere: Job = {
    steps: [
      { id: 'gate', run: 'bash .github/scripts/secret-gate.sh NEON_API_KEY' },
      { ...deploy, if: gated },
    ],
  };
  expect(gateFaults(elsewhere)).toEqual(['gate on NEON_API_KEY']);
  expect(gateFaults({ env: { TOKEN: 'secrets.X_TOKEN' }, steps: [] })).toEqual([
    'gate on nothing',
    'job env',
  ]);
  expect(secretNames({ env: { GH: 'secrets.GITHUB_TOKEN' } })).toEqual([]);
}

describe('GL-1 every go-live job runs when its secret exists and skips while it is absent', () => {
  it('GL-1 finds every job that reads a secret GitHub does not issue, each behind a gate on a secret it reads', () => {
    const jobs = secretJobs();
    expect(jobs.map((found) => found.site)).toEqual([
      'cleanup-pr.yml cleanup-pr',
      'cleanup-pr.yml drop-neon-branch',
      'deploy-pr.yml deploy-pr',
      'deploy-production.yml migrate-production',
      'deploy-production.yml deploy-production',
      'deploy-production.yml deploy-ingest-production',
      'deploy-staging.yml migrate-staging',
      'deploy-staging.yml deploy-staging',
      'deploy-staging.yml deploy-ingest-staging',
      'neon-pr.yml neon-branch',
    ]);
    for (const { site, job } of jobs) {
      expect(gateFaults(job), site).toEqual([]);
      expect(job.if ?? '', site).not.toMatch(/secrets/);
    }
  });

  it('GL-1 the gate opens each job when its secret is set and keeps it green when it is not', () => {
    for (const { job } of secretJobs()) {
      expect(runGate(gateSecret(job), true)).toBe('configured=true\n');
      expect(runGate(gateSecret(job), false)).toBe('configured=false\n');
    }
  });

  it(
    'GL-1 flags a planted job that reads a secret before its gate, runs a step outside it, or has no gate',
    plantedFaultsAreFlagged,
  );
});

describe('GL-1 the runbook switches on what the go-live files leave unset', () => {
  it('GL-1 names every secret a go-live job reads and every value still set-at-go-live', () => {
    const section = switchSection();
    const secrets = goLiveSettings();
    expect(secrets).toEqual([
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
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

const restatedRequirement = /\bFD-(?:6|7|10|12)\b/;
const citation = /GL-1 switch, step (\d+)/;
const closedLive = /None: closed by the live run/;
const trackerSections = ['## Go-live hand-off', '## Not verified', '## Waiting on a person'];

function sectionRows(tracker: string, heading: string): string[] {
  const lines = tracker.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith('| '));
}

function requirementOf(row: string): string {
  const cells = row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
  return /^\d{4}-\d{2}-\d{2}$/.test(cells[0] ?? '') ? (cells[1] ?? '') : (cells[2] ?? '');
}

function tracker(): string {
  return readFileSync('docs/progress_tracker.md', 'utf8');
}

function restatedRows(): string[] {
  const text = tracker();
  return trackerSections
    .flatMap((heading) => sectionRows(text, heading))
    .filter((row) => restatedRequirement.test(requirementOf(row)));
}

function uncited(rows: readonly string[], steps: readonly number[]): string[] {
  return rows.filter(
    (row) => !closedLive.test(row) && !steps.includes(Number(citation.exec(row)?.[1])),
  );
}

describe('GL-1 the tracker restates what FD-6, FD-7, FD-10 and FD-12 still miss', () => {
  it('GL-1 every hand-off, Not verified and Waiting on a person row for them cites the runbook step that closes it', () => {
    const rows = restatedRows();
    expect(rows.length).toBeGreaterThanOrEqual(28);
    expect(uncited(rows, runbookSteps(switchSection()))).toEqual([]);
  });

  it('GL-1 waits on a person for the live switch, in its own row and in the hand-off', () => {
    const text = tracker();
    const waiting = sectionRows(text, '## Waiting on a person').map(requirementOf);
    const handOff = sectionRows(text, '## Go-live hand-off').map(requirementOf);
    expect(waiting).toContain('GL-1');
    expect(handOff).toContain('GL-1');
  });

  it('GL-1 flags a row that cites no step or a step the runbook does not have', () => {
    const rows = [
      '| 2026-10-01 | FD-7 | x | y |',
      '| 2026-10-01 | FD-10 | x | see the GL-1 switch, step 9 |',
      '| 2026-10-01 | FD-12 | x | see the GL-1 switch, step 1 |',
      '| Not verified | 2026-10-01 | FD-6 FD-10 | None: closed by the live run on 2026-11-01. | x |',
    ];
    expect(uncited(rows, [1, 2])).toEqual(rows.slice(0, 2));
    expect(rows.map(requirementOf)).toEqual(['FD-7', 'FD-10', 'FD-12', 'FD-6 FD-10']);
  });
});
