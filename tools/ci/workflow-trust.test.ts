import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = {
  uses?: string;
  run?: string;
  'working-directory'?: string;
  with?: { ref?: string; path?: string; 'persist-credentials'?: boolean };
};
type Job = { if?: string; steps?: Step[] };
type Workflow = { file: string; triggers: string[]; tree: unknown; jobs: Record<string, Job> };

const directory = '.github/workflows';
const defaultBranch = '${{ github.event.repository.default_branch }}';
const workflowRunHead = '${{ github.event.workflow_run.head_sha }}';

const trustedCheckoutRefs: Record<string, (string | null)[]> = {
  'cleanup-pr.yml': [defaultBranch, defaultBranch],
  'deploy-pr.yml': [null],
  'deploy-production.yml': [null, null, null, null],
  'deploy-staging.yml': [workflowRunHead, workflowRunHead, workflowRunHead],
  'neon-pr.yml': [null, workflowRunHead],
  'main-alarm.yml': [],
};

function triggersOf(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return on && typeof on === 'object' ? Object.keys(on) : [];
}

function load(file: string): Workflow {
  const tree: { on?: unknown; jobs?: Record<string, Job> } = parse(
    readFileSync(join(directory, file), 'utf8'),
  );
  return { file, triggers: triggersOf(tree.on), tree, jobs: tree.jobs ?? {} };
}

function scalarsAndKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(scalarsAndKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...scalarsAndKeys(child)]);
  }
  return [String(value)];
}

function checkoutRefs(workflow: Workflow): (string | null)[] {
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith('actions/checkout@'))
    .map((step) => step.with?.ref ?? null);
}

function mentionsSecrets(workflow: Workflow): boolean {
  return scalarsAndKeys(workflow.tree).some((text) => /\bsecrets\b/.test(text));
}

const stagingGuard = [
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
];

function isGreenPushToMain(guard: string): boolean {
  return stagingGuard.every((condition) => guard.includes(condition));
}

const workflows = readdirSync(directory).map(load);
const runsPrCode = (workflow: Workflow): boolean => workflow.triggers.includes('pull_request');
const untrusted = workflows.filter(runsPrCode);
const trusted = workflows.filter((workflow) => !runsPrCode(workflow));

describe('workflows that run PR code', () => {
  it('reference no secret in any spelling', () => {
    const exposed = untrusted.filter(mentionsSecrets).map((workflow) => workflow.file);
    expect(exposed).toEqual([]);
  });
});

describe('workflows that can hold a secret', () => {
  it('are each listed with the refs they may check out', () => {
    expect(trusted.map((workflow) => workflow.file).sort()).toEqual(
      Object.keys(trustedCheckoutRefs).sort(),
    );
  });

  it('check out only the listed refs, and read PR code only as data, never execute it', () => {
    const actual = Object.fromEntries(
      trusted.map((workflow) => [workflow.file, checkoutRefs(workflow)]),
    );
    expect(actual).toEqual(trustedCheckoutRefs);
  });

  it('check out the workflow_run head only for a green push to main', () => {
    const staging = load('deploy-staging.yml');
    const on: unknown = parse(readFileSync(join(directory, 'deploy-staging.yml'), 'utf8')).on;
    expect(on).toEqual({
      workflow_run: { workflows: ['CI'], types: ['completed'], branches: ['main'] },
    });
    const guards = Object.values(staging.jobs).map((job) => job.if ?? '');
    expect(guards.length).toBeGreaterThan(0);
    expect(guards.every(isGreenPushToMain)).toBe(true);
  });
});

describe('neon-pr reads the PR head only as data', () => {
  const steps = load('neon-pr.yml').jobs['neon-branch']?.steps ?? [];
  const prCheckouts = steps.filter((step) => step.with?.ref === workflowRunHead);
  const mentionsPr = (step: Step): boolean => /\bpr\//.test(JSON.stringify(step));

  it('checks the PR head out beside main, without credentials', () => {
    expect(prCheckouts).toHaveLength(1);
    expect(prCheckouts[0]?.with?.path).toBe('pr');
    expect(prCheckouts[0]?.with?.['persist-credentials']).toBe(false);
  });

  it('runs nothing inside the PR checkout', () => {
    const inside = steps.filter((step) => (step['working-directory'] ?? '').startsWith('pr'));
    expect(inside).toEqual([]);
  });

  it('references pr/ only in the one step that copies the migration files', () => {
    const referencing = steps.filter(mentionsPr);
    expect(referencing).toHaveLength(1);
    expect(referencing[0]?.run).toContain('cp -R pr/packages/db/migrations');
    expect(referencing[0]?.run).toContain('-type l');
  });
});
