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

type Entry = {
  readonly reviewer: number;
  readonly reviewerStyle: number;
  readonly provider: number | null;
  readonly providerStyle: number;
  readonly onHead: boolean;
};

type Mutation = 'none' | 'draft' | 'closed' | 'moved' | 'red' | 'missing' | 'noPullRequest';

type Scenario = {
  readonly entries: readonly Entry[];
  readonly mutation: Mutation;
  readonly riskTier: 'low' | 'standard' | 'high' | null;
  readonly riskDomains: ShipRuleInput['riskDomains'];
  readonly approver: ShipRuleInput['approver'];
  readonly override: boolean;
};

const reviewerNames = ['r1', 'r2', 'r3'];
const providerNames = ['anthropic', 'openai', 'google'];
const styles: readonly ((value: string) => string)[] = [
  (value) => value,
  (value) => value.toUpperCase(),
  (value) => ` ${value} `,
];

const entryArb: fc.Arbitrary<Entry> = fc.record({
  reviewer: fc.nat(2),
  reviewerStyle: fc.nat(2),
  provider: fc.option(fc.nat(2), { nil: null }),
  providerStyle: fc.nat(2),
  onHead: fc.boolean(),
});

const mutations: readonly Mutation[] = [
  'none',
  'none',
  'none',
  'none',
  'draft',
  'closed',
  'moved',
  'red',
  'missing',
  'noPullRequest',
];

const approverPool = [
  { role: 'admin', scope: 'org', expiresAt: null },
  { role: 'admin', scope: '80-89', expiresAt: null },
  { role: 'editor', scope: '80-89', expiresAt: null },
];

const biasedApprovers = fc
  .subarray(approverPool, { minLength: 1 })
  .map((held) => buildApprover(held));

function buildApprover(held: readonly (typeof approverPool)[number][]) {
  return principalSchema.parse({
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
  });
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  entries: fc.array(entryArb, { maxLength: 4 }),
  mutation: fc.constantFrom(...mutations),
  riskTier: fc.constantFrom('low', 'standard', 'high', 'high', null),
  riskDomains: fc.subarray(['acl', 'infra'] as const, { maxLength: 1 }),
  approver: biasedApprovers,
  override: fc.boolean(),
});

function checksFor(mutation: Mutation): ShipRuleInput['checks'] {
  return ciJobSchema.options
    .filter((name) => !(mutation === 'missing' && name === 'lint'))
    .map((name) => ({
      name,
      headSha: 'abc',
      conclusion:
        mutation === 'red' && name === 'test' ? ('failure' as const) : ('success' as const),
    }));
}

function pullRequestFor(mutation: Mutation): ShipRuleInput['pullRequest'] {
  if (mutation === 'noPullRequest') return null;
  const head = mutation === 'moved' ? 'def' : 'abc';
  return { open: mutation !== 'closed', draft: mutation === 'draft', head };
}

function approvalsFor(entries: readonly Entry[]): ShipRuleInput['approvals'] {
  return entries.map((entry) => {
    const reviewer = styles[entry.reviewerStyle]?.(reviewerNames[entry.reviewer] ?? '') ?? '';
    const named = entry.provider === null ? null : (providerNames[entry.provider] ?? null);
    const provider = named === null ? null : (styles[entry.providerStyle]?.(named) ?? null);
    return { reviewer, commit: entry.onHead ? 'abc' : 'old', provider };
  });
}

function inputOf(scenario: Scenario): ShipRuleInput {
  return shipRuleInputSchema.parse({
    pullRequest: pullRequestFor(scenario.mutation),
    expectedHead: 'abc',
    checks: checksFor(scenario.mutation),
    approvals: approvalsFor(scenario.entries),
    riskTier: scenario.riskTier,
    riskDomains: scenario.riskDomains,
    area: '80-89',
    approver: scenario.approver,
    at: '2026-10-01T09:00:00.000Z',
    override: scenario.override,
  });
}

function highHolds(entries: readonly Entry[]): boolean {
  const onHead = entries.filter((entry) => entry.onHead);
  const reviewers = new Set(onHead.map((entry) => entry.reviewer));
  const resolved = new Set<number>();
  for (const reviewer of reviewers) {
    const labels = new Set(
      onHead.filter((e) => e.reviewer === reviewer && e.provider !== null).map((e) => e.provider),
    );
    const [only] = [...labels];
    if (labels.size === 1 && only !== undefined && only !== null) resolved.add(only);
  }
  return reviewers.size >= 2 && resolved.size >= 2;
}

function expectedAdvance(scenario: Scenario): boolean {
  const reviewed = scenario.entries.some((entry) => entry.onHead) || scenario.override;
  const tier =
    scenario.riskTier !== null && (scenario.riskTier !== 'high' || highHolds(scenario.entries));
  const covers = approverCovers(
    scenario.approver,
    '80-89',
    scenario.riskDomains,
    new Date('2026-10-01T09:00:00.000Z'),
  );
  return scenario.mutation === 'none' && reviewed && tier && covers;
}

const tally = { advances: 0, refusals: 0 };

function checkAgainstOracle(scenario: Scenario): void {
  const outcome = shipRule(inputOf(scenario));
  const expected = expectedAdvance(scenario);
  if (expected) tally.advances += 1;
  else tally.refusals += 1;
  expect(outcome.verdict === 'advance').toBe(expected);
}

describe('KN-12 the ship rule is deterministic over random inputs', () => {
  it('is a pure function of its input with a well-formed, ordered, distinct outcome', () => {
    fc.assert(fc.property(inputArb, checkPure), { numRuns: 1000 });
  });

  it('lets override remove no_reviewer_approval and nothing else', () => {
    fc.assert(fc.property(inputArb, checkOverride), { numRuns: 1000 });
  });

  it('advances exactly when an independent oracle says so, and reaches both branches', () => {
    fc.assert(fc.property(scenarioArb, checkAgainstOracle), { numRuns: 1000 });
    expect(tally.advances).toBeGreaterThan(0);
    expect(tally.refusals).toBeGreaterThan(0);
  });
});
