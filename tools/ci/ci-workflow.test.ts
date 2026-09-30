import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../package.json' with { type: 'json' };

const checkRunContract = ['security-audit', 'lint', 'typecheck', 'architecture', 'test', 'build'];

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
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
