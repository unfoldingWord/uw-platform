import { describe, expect, it } from 'vitest';
import { bypassesShip, describeViolation, templateProperty, templates } from './index.ts';

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
      { path: ['package', 'scope', 'plan', 'build', 'hotfix'], effectStage: 'hotfix' },
    ]);
  });

  it('says so in words', () => {
    const [violation] = templateProperty(bypassesShip.stages);
    expect(violation && describeViolation(violation)).toBe(
      'path package > scope > plan > build > hotfix reaches hotfix, which has an external effect, without a human_approval exit',
    );
  });
});
