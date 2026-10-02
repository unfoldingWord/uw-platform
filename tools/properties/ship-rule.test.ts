import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkConclusionSchema,
  ciJobSchema,
  principalSchema,
  shipRefusalSchema,
  shipRuleInputSchema,
  shipRuleOutcomeSchema,
  type ShipRuleInput,
} from '../../packages/contracts/index.ts';
import { approverCovers, shipRule } from '../../packages/harness/index.ts';

const heads = fc.constantFrom('a', 'b');
const jobs = fc.constantFrom(...ciJobSchema.options, 'extra');
const conclusions = fc.constantFrom(...checkConclusionSchema.options, null);
const providers = fc.constantFrom('anthropic', 'Anthropic', ' openai', 'openai', null);
const areas = fc.constantFrom('20-29', '80-89');
const domains = fc.subarray(['ledger', 'acl', 'infra', 'migration'] as const);
const expiries = fc.constantFrom(null, '2026-09-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');

const grantArb = fc.record({
  role: fc.constantFrom('admin', 'editor', 'viewer'),
  scope: fc.constantFrom('org', '20-29', '80-89'),
  expiresAt: expiries,
});

const approverArb = fc.array(grantArb, { maxLength: 4 }).map((held) =>
  principalSchema.parse({
    identity: 'human:00000000-0000-4000-8000-000000000a01',
    kind: 'person',
    personId: '00000000-0000-4000-8000-000000000a01',
    email: 'approver@unfoldingword.org',
    interactive: true,
    grants: held.map((entry, index) => ({
      grantId: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
      role: entry.role,
      scopeKind: entry.scope === 'org' ? 'org' : 'jd_area',
      scopeArea: entry.scope === 'org' ? null : entry.scope,
      expiresAt: entry.expiresAt,
    })),
  }),
);

const inputArb: fc.Arbitrary<ShipRuleInput> = fc
  .record({
    pullRequest: fc.option(fc.record({ open: fc.boolean(), draft: fc.boolean(), head: heads }), {
      nil: null,
    }),
    expectedHead: fc.option(heads, { nil: null }),
    checks: fc.array(fc.record({ name: jobs, headSha: heads, conclusion: conclusions }), {
      maxLength: 12,
    }),
    approvals: fc.array(
      fc.record({
        reviewer: fc.constantFrom('r1', 'R1', ' r2', 'r2', 'r3'),
        commit: heads,
        provider: providers,
      }),
      { maxLength: 4 },
    ),
    riskTier: fc.constantFrom('low', 'standard', 'high', null),
    riskDomains: domains,
    area: areas,
    approver: approverArb,
    at: fc.constantFrom('2026-10-01T09:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    override: fc.boolean(),
  })
  .map((input) => shipRuleInputSchema.parse(input));

function reasonsOf(input: ShipRuleInput): readonly string[] {
  const outcome = shipRule(input);
  return outcome.verdict === 'refuse' ? outcome.reasons : [];
}

function checkPure(input: ShipRuleInput): void {
  const outcome = shipRule(input);
  expect(outcome).toEqual(shipRule(structuredClone(input)));
  expect(shipRuleOutcomeSchema.safeParse(outcome).success).toBe(true);
  const order = shipRefusalSchema.options as readonly string[];
  const positions = reasonsOf(input).map((reason) => order.indexOf(reason));
  expect(positions).toEqual([...new Set(positions)].sort((left, right) => left - right));
}

function checkOverride(input: ShipRuleInput): void {
  const plain = reasonsOf({ ...input, override: false });
  const overridden = reasonsOf({ ...input, override: true });
  expect(overridden).toEqual(plain.filter((reason) => reason !== 'no_reviewer_approval'));
}

function clean(value: string): string {
  return value.trim().toLowerCase();
}

function reviewerProviders(input: ShipRuleInput): Map<string, Set<string>> {
  const byReviewer = new Map<string, Set<string>>();
  const head = input.pullRequest?.head;
  for (const approval of input.approvals.filter((entry) => entry.commit === head)) {
    const providers = byReviewer.get(clean(approval.reviewer)) ?? new Set<string>();
    if (approval.provider !== null) providers.add(clean(approval.provider));
    byReviewer.set(clean(approval.reviewer), providers);
  }
  return byReviewer;
}

function highHolds(input: ShipRuleInput): boolean {
  const resolved = [...reviewerProviders(input).values()].filter((set) => set.size === 1);
  const distinct = new Set(resolved.map((set) => [...set].join()));
  return reviewerProviders(input).size >= 2 && distinct.size >= 2;
}

function checksGreen(input: ShipRuleInput, head: string): boolean {
  return ciJobSchema.options.every((job) => {
    const runs = input.checks.filter((c) => c.name === job && c.headSha === head);
    return runs.length > 0 && runs.every((c) => c.conclusion === 'success');
  });
}

function tierHolds(input: ShipRuleInput): boolean {
  return input.riskTier !== null && (input.riskTier !== 'high' || highHolds(input));
}

function advanceImplies(input: ShipRuleInput): boolean {
  const pr = input.pullRequest;
  if (pr === null || input.expectedHead === null) return false;
  const reviewed = reviewerProviders(input).size >= 1 || input.override;
  const covers = approverCovers(input.approver, input.area, input.riskDomains, new Date(input.at));
  const open = pr.open && !pr.draft && pr.head === input.expectedHead;
  return open && checksGreen(input, pr.head) && reviewed && tierHolds(input) && covers;
}

function checkAdvance(input: ShipRuleInput): void {
  if (shipRule(input).verdict === 'advance') expect(advanceImplies(input)).toBe(true);
}

describe('KN-12 the ship rule is deterministic over random inputs', () => {
  it('is a pure function of its input with a well-formed, ordered, distinct outcome', () => {
    fc.assert(fc.property(inputArb, checkPure), { numRuns: 1000 });
  });

  it('lets override remove no_reviewer_approval and nothing else', () => {
    fc.assert(fc.property(inputArb, checkOverride), { numRuns: 1000 });
  });

  it('advances only when every fact holds', () => {
    fc.assert(fc.property(inputArb, checkAdvance), { numRuns: 1000 });
  });
});
