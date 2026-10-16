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

describe('the gate view carries each Reviewer review', () => {
  const review = {
    reviewer: 'codex-bot',
    commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    state: 'changes_requested',
    provider: 'openai',
    findings: [{ text: 'The lock is taken late', weight: null }],
  };
  const withReviews = (reviews: readonly unknown[]) => ({ ...view, reviews });

  it("carries each Reviewer's latest review with its findings, bounded", () => {
    expect(gateViewSchema.safeParse(withReviews([review])).success).toBe(true);
    const long = { ...review, findings: [{ text: 'x'.repeat(501), weight: null }] };
    const many = {
      ...review,
      findings: Array.from({ length: 51 }, (_, n) => ({ text: `finding ${n}`, weight: null })),
    };
    const unknown = { ...review, state: 'commented' };
    expect(gateViewSchema.safeParse(withReviews([long])).success).toBe(false);
    expect(gateViewSchema.safeParse(withReviews([many])).success).toBe(false);
    expect(gateViewSchema.safeParse(withReviews([unknown])).success).toBe(false);
  });

  it('reads an 11.0.0 gate view without reviews as having none', () => {
    const older = Object.fromEntries(Object.entries(view).filter(([key]) => key !== 'reviews'));
    expect(gateViewSchema.parse(older).reviews).toEqual([]);
  });
});
