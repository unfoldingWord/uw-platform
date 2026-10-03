import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateViewSchema } from './gate-view.ts';

const view = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/gate-view/valid/ship-ready.json'), 'utf8'),
);

function withFacts(declaration: Record<string, unknown>) {
  return {
    ...view,
    facts: { ...view.facts, declaration: { ...view.facts.declaration, ...declaration } },
  };
}

function withReasons(reasons: readonly string[]) {
  return { ...view, ship: { ...view.ship, outcome: { verdict: 'refuse', reasons } } };
}

describe('the gate view is bounded', () => {
  it('caps the declared closes at fifty', () => {
    const closes = (count: number) => Array.from({ length: count }, (_, n) => `#${n + 1}`);
    expect(gateViewSchema.safeParse(withFacts({ closes: closes(50) })).success).toBe(true);
    expect(gateViewSchema.safeParse(withFacts({ closes: closes(51) })).success).toBe(false);
  });

  it('takes each ship refusal once', () => {
    expect(gateViewSchema.safeParse(withReasons(['pr_is_draft', 'head_mismatch'])).success).toBe(
      true,
    );
    expect(gateViewSchema.safeParse(withReasons(['pr_is_draft', 'pr_is_draft'])).success).toBe(
      false,
    );
  });
});
