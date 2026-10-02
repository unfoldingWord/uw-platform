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
import { shipRule } from '../../packages/harness/index.ts';

const heads = fc.constantFrom('a', 'b');
const jobs = fc.constantFrom(...ciJobSchema.options, 'extra');
const conclusions = fc.constantFrom(...checkConclusionSchema.options, null);
const providers = fc.constantFrom('anthropic', 'openai', null);
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
        reviewer: fc.constantFrom('r1', 'r2', 'r3'),
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

describe('KN-12 the ship rule is deterministic over random inputs', () => {
  it('is a pure function of its input with a well-formed, ordered, distinct outcome', () => {
    fc.assert(fc.property(inputArb, checkPure), { numRuns: 1000 });
  });

  it('lets override remove no_reviewer_approval and nothing else', () => {
    fc.assert(fc.property(inputArb, checkOverride), { numRuns: 1000 });
  });
});
