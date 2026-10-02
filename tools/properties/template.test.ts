import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { templateProperty, walk, type WalkStage } from '../../packages/harness/index.ts';

const exits = ['none', 'checks', 'human_approval'] as const;
const connectors = ['none', 'merge', 'publish'] as const;

type Draft = {
  readonly exitGate: (typeof exits)[number];
  readonly connector: (typeof connectors)[number];
  readonly feedPicks: readonly number[];
};

const draft = fc.record({
  exitGate: fc.constantFrom(...exits),
  connector: fc.constantFrom(...connectors),
  feedPicks: fc.array(fc.nat(7), { maxLength: 3 }),
});

const drafts = fc.array(draft, { minLength: 2, maxLength: 8 });

function build(entries: readonly Draft[], guarded: boolean): WalkStage[] {
  const keys = entries.map((_entry, index) => `s${index}`);
  return entries.map((entry, index) => ({
    key: keys[index] ?? 's',
    position: (index + 1) * 10,
    exitGate: guarded && entry.connector !== 'none' ? 'human_approval' : entry.exitGate,
    connector: entry.connector,
    feeds: [...new Set(entry.feedPicks.map((pick) => keys[pick % keys.length] ?? 's0'))],
  }));
}

function isPrefixOfSome(path: readonly string[], all: readonly (readonly string[])[]): boolean {
  return all.some((candidate) => path.every((key, index) => candidate[index] === key));
}

function assertViolationsAreReal(entries: readonly Draft[]): void {
  const stages = build(entries, false);
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const walked = walk(stages).map((path) => path.map((step) => step.key));
  for (const violation of templateProperty(stages)) {
    expect(isPrefixOfSome(violation.path, walked)).toBe(true);
    expect(violation.path.at(-1)).toBe(violation.effectStage);
    expect(byKey.get(violation.effectStage)?.connector).not.toBe('none');
    expect(violation.path.some((key) => byKey.get(key)?.exitGate === 'human_approval')).toBe(false);
  }
}

describe('KN-10 the property holds on random stage graphs the database accepts, and every reported path is real', () => {
  it('is empty when every stage with a connector has a human_approval exit', () => {
    fc.assert(
      fc.property(drafts, (entries) => {
        expect(templateProperty(build(entries, true))).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('reports only real paths that end at a connector and hold no human_approval exit', () => {
    fc.assert(fc.property(drafts, assertViolationsAreReal), { numRuns: 300 });
  });
});
