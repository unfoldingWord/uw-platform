import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../package.json' with { type: 'json' };

const checkRunContract = ['security-audit', 'lint', 'typecheck', 'architecture', 'test', 'build'];

const workflowDirectory = '.github/workflows';
const workflows = readdirSync(workflowDirectory).map((file) => ({
  file,
  source: readFileSync(join(workflowDirectory, file), 'utf8'),
}));
const ci = readFileSync(join(workflowDirectory, 'ci.yml'), 'utf8');
const productionGate = readFileSync('.github/scripts/require-green-ci.sh', 'utf8');

function jobNames(workflow: string): string[] {
  return [...workflow.matchAll(/^ {4}name: (\S+)$/gm)].map((match) => match[1] ?? '');
}

function pnpmSteps(workflow: string): string[] {
  return [...workflow.matchAll(/^ {6}- run: pnpm (\S+)$/gm)].map((match) => match[1] ?? '');
}

function verifySteps(): string[] {
  return manifest.scripts.verify.split('&&').map((step) => step.trim().replace(/^pnpm /, ''));
}

describe('the CI workflow', () => {
  it('names its jobs exactly as the check-run contract', () => {
    expect(jobNames(ci)).toEqual(checkRunContract);
  });

  it('runs every step of pnpm verify', () => {
    const run = pnpmSteps(ci);
    expect(verifySteps().filter((step) => !run.includes(step))).toEqual([]);
  });

  it('is the set of jobs production requires green', () => {
    expect(productionGate).toContain(`required=(${checkRunContract.join(' ')})`);
  });
});

describe('the workflows that run PR code', () => {
  it('never see a secret', () => {
    const exposed = workflows
      .filter(({ source }) => /^ {2}pull_request:$/m.test(source) && source.includes('secrets.'))
      .map(({ file }) => file);
    expect(exposed).toEqual([]);
  });

  it('are the only ones that check out the PR head', () => {
    const trusted = workflows
      .filter(({ source }) => !/^ {2}pull_request:$/m.test(source))
      .filter(({ source }) => source.includes('pull_request.head'))
      .map(({ file }) => file);
    expect(trusted).toEqual([]);
  });
});
