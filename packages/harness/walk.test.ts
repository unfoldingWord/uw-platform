import { describe, expect, it } from 'vitest';
import { effectPaths, walk, WalkError, type WalkStage } from './index.ts';

function stage(key: string, position: number, extra: Partial<WalkStage> = {}): WalkStage {
  return { key, position, exitGate: 'none', connector: 'none', feeds: [], ...extra };
}

const eightStages: readonly WalkStage[] = Object.freeze([
  stage('package', 10),
  stage('scope', 20),
  stage('plan', 30, { exitGate: 'checks' }),
  stage('build', 40, { exitGate: 'checks' }),
  stage('check', 50, { exitGate: 'checks' }),
  stage('ship', 60, { exitGate: 'human_approval', connector: 'merge' }),
  stage('validate', 70, { feeds: ['package'] }),
  stage('close', 80, { exitGate: 'checks', feeds: ['scope'] }),
]);

function keys(path: readonly { key: string; revisited: boolean }[]): string[] {
  return path.map((step) => (step.revisited ? `${step.key}*` : step.key));
}

function threeStages(): WalkStage[] {
  return [
    stage('a', 10),
    stage('b', 20, { exitGate: 'checks' }),
    stage('c', 30, { exitGate: 'human_approval', connector: 'merge' }),
  ];
}

const threeStagePath = [
  { key: 'a', exitGate: 'none', connector: 'none', revisited: false },
  { key: 'b', exitGate: 'checks', connector: 'none', revisited: false },
  { key: 'c', exitGate: 'human_approval', connector: 'merge', revisited: false },
];

function failureOf(stages: readonly WalkStage[]): unknown {
  try {
    walk(stages);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('KN-9 walk over position order and feeds edges', () => {
  it('walks three stages in position order as one path', () => {
    expect(walk(threeStages())).toEqual([threeStagePath]);
  });

  it('orders by position, not by input order', () => {
    const [a, b, c] = threeStages();
    expect(walk([c!, a!, b!])).toEqual([threeStagePath]);
  });

  it('follows the next stage first, then each feeds edge, cutting a cycle at the first revisit', () => {
    expect(walk(eightStages).map(keys)).toEqual([
      ['package', 'scope', 'plan', 'build', 'check', 'ship', 'validate', 'close', 'scope*'],
      ['package', 'scope', 'plan', 'build', 'check', 'ship', 'validate', 'package*'],
    ]);
  });

  it('cuts a stage that feeds itself after one revisit', () => {
    expect(walk([stage('a', 10, { feeds: ['a'] })]).map(keys)).toEqual([['a', 'a*']]);
  });

  it('counts a feeds edge to the next stage once', () => {
    expect(walk([stage('a', 10, { feeds: ['b'] }), stage('b', 20)]).map(keys)).toEqual([
      ['a', 'b'],
    ]);
  });

  it('returns no paths for no stages', () => {
    expect(walk([])).toEqual([]);
  });

  it('leaves a frozen input unchanged', () => {
    const before = eightStages.map((entry) => ({ ...entry, feeds: [...entry.feeds] }));
    expect(() => walk(eightStages)).not.toThrow();
    expect(eightStages).toEqual(before);
  });
});

describe('KN-9 walk refuses a graph it cannot walk', () => {
  it('names the stage that feeds an unknown stage', () => {
    const error = failureOf([stage('a', 10, { feeds: ['ghost'] })]);
    expect(error).toBeInstanceOf(WalkError);
    expect(error).toMatchObject({ stage: 'a', message: 'stage a feeds unknown stage ghost' });
  });

  it('refuses a key that appears twice', () => {
    const error = failureOf([stage('a', 10), stage('a', 20)]);
    expect(error).toBeInstanceOf(WalkError);
    expect(error).toMatchObject({ message: 'stage a appears twice' });
  });

  it('refuses two stages that share a position', () => {
    const error = failureOf([stage('b', 10), stage('a', 10)]);
    expect(error).toBeInstanceOf(WalkError);
    expect(error).toMatchObject({ message: 'stages a and b share position 10' });
  });
});

describe('KN-9 effectPaths', () => {
  it('deduplicates the shared prefix up to the one effect stage', () => {
    const found = effectPaths(walk(eightStages));
    expect(found).toHaveLength(1);
    expect(keys(found[0]!.steps)).toEqual(['package', 'scope', 'plan', 'build', 'check', 'ship']);
  });

  it('keeps a revisited effect stage', () => {
    const only = stage('a', 10, { connector: 'post', exitGate: 'human_approval', feeds: ['a'] });
    expect(effectPaths(walk([only])).map((path) => keys(path.steps))).toEqual([['a'], ['a', 'a*']]);
  });
});
