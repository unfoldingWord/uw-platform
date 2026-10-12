import { describe, expect, it } from 'vitest';
import {
  bypassesShip,
  describeViolation,
  templateProperty,
  templates,
  type WalkStage,
} from './index.ts';

describe('KN-10 every registered template reaches an effect only after a human_approval exit', () => {
  it.each([...templates.values()].map((template) => [template.key, template] as const))(
    '%s passes on every walked path',
    (_key, template) => {
      expect(templateProperty(template.stages)).toEqual([]);
    },
  );
});

describe('KN-10 the negative fixture with a feeds edge around Ship fails, naming the path and the effect stage', () => {
  it('reports the bypass', () => {
    expect(templateProperty(bypassesShip.stages)).toEqual([
      {
        path: ['package', 'scope', 'plan', 'build', 'check', 'ship', 'hotfix'],
        effectStage: 'hotfix',
      },
      { path: ['package', 'scope', 'plan', 'build', 'hotfix'], effectStage: 'hotfix' },
    ]);
  });

  it('says so in words', () => {
    const violation = templateProperty(bypassesShip.stages).find(
      (found) => !found.path.includes('ship'),
    );
    expect(violation && describeViolation(violation)).toBe(
      'path package > scope > plan > build > hotfix reaches hotfix, which has an external effect, without a human_approval exit',
    );
  });
});

function stage(key: string, position: number, extra: Partial<WalkStage> = {}): WalkStage {
  return { key, position, exitGate: 'none', connector: 'none', feeds: [], ...extra };
}

describe('KN-10 an earlier approval does not cover a later effect stage on a second lap', () => {
  it('reports the effect stage whose own exit is not human_approval', () => {
    const stages = [
      stage('p', 10),
      stage('a', 20, { exitGate: 'human_approval' }),
      stage('b', 30, { exitGate: 'checks' }),
      stage('e', 40, { exitGate: 'checks', connector: 'merge' }),
      stage('z', 50, { exitGate: 'checks', feeds: ['b'] }),
    ];
    const reported = templateProperty(stages);
    expect(reported.map((violation) => violation.effectStage)).toEqual(['e']);
    expect(reported[0]?.path).toEqual(['p', 'a', 'b', 'e']);
  });
});
