import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function codeOwners(): string[] {
  const lines = readFileSync('.github/CODEOWNERS', 'utf8').split('\n');
  const rule = lines.find((line) => line.startsWith('* '));
  return (rule ?? '')
    .split(/\s+/)
    .slice(1)
    .map((owner) => owner.replace(/^@/, ''))
    .sort();
}

function deployers(): string[] {
  return readFileSync('.github/production-deployers', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .sort();
}

describe('the owners are named the same way in every repository list', () => {
  it('the code owners of every path are exactly the production deployers', () => {
    expect(codeOwners().length).toBeGreaterThan(0);
    expect(codeOwners()).toEqual(deployers());
  });

  it('no path rule names an owner the catch-all rule does not', () => {
    const named = readFileSync('.github/CODEOWNERS', 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .flatMap((line) => line.split(/\s+/).slice(1))
      .map((owner) => owner.replace(/^@/, ''));
    expect(named.filter((owner) => !codeOwners().includes(owner))).toEqual([]);
  });
});
