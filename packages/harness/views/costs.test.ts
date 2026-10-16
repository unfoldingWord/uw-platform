import { describe, expect, it } from 'vitest';
import { itemStateSchema, runStepRecordSchema, type Identity, type ItemState } from '@uw/contracts';
import type { RunRow } from '../ports.ts';
import { ZERO_COST, basesOf, costOf, hostOf } from './costs.ts';

const at = '2026-10-01T09:00:00.000Z';
const person = '00000000-0000-4000-8000-000000000106';

function step(tokensIn: number, tokensOut: number, costMinor: number | null = null) {
  return runStepRecordSchema.parse({ step: 'work', tokensIn, tokensOut, costMinor, at });
}

function run(overrides: Partial<RunRow>): RunRow {
  return {
    id: '00000000-0000-4000-8000-000000000601',
    harnessId: '00000000-0000-4000-8000-000000000a01',
    itemId: '00000000-0000-4000-8000-000000000b01',
    persona: 'agent:builder' as Identity,
    personaPageId: null,
    delegationId: null,
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    pinnedProvider: null,
    resolvedProvider: null,
    steps: [],
    costMinor: null,
    computeMinor: null,
    costBasis: 'metered',
    traceId: '00000000-0000-4000-8000-000000000701',
    outcome: 'completed',
    hibernatedFor: null,
    failure: null,
    gates: [],
    prompts: [],
    startedAt: new Date(at),
    endedAt: null,
    ...overrides,
  };
}

const metered = run({ costMinor: 40, computeMinor: 5, steps: [step(100, 20, 40)] });
const subscription = run({
  runShape: 'external-run',
  engine: 'external',
  costBasis: 'subscription',
  steps: [step(900, 300), step(50, 50)],
});

function item(holder: string | null): ItemState {
  return itemStateSchema.parse({
    itemId: '00000000-0000-4000-8000-000000000b01',
    harnessId: '00000000-0000-4000-8000-000000000a01',
    stageKey: 'build',
    title: 'Draw the board',
    pageId: null,
    priority: 1,
    due: null,
    holder,
    claimantKind: holder === null ? null : holder.startsWith('human:') ? 'person' : 'agent',
    delegationId: null,
    leaseExpiresAt: holder === null ? null : at,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: null,
    riskTier: null,
    riskDomains: [],
    pullRequest: null,
    issue: null,
    zulipTopic: null,
    epic: null,
    blockedBy: [],
  });
}

describe('the cost of a set of runs', () => {
  it('WB-4 metered cost and subscription tokens are totalled apart and never summed', () => {
    expect(costOf([metered, subscription, metered])).toEqual({
      meteredMinor: 80,
      computeMinor: 10,
      meteredTokens: 240,
      subscriptionTokens: 1300,
      currency: 'USD',
    });
    expect(costOf([subscription])).toEqual({ ...ZERO_COST, subscriptionTokens: 1300 });
    expect(costOf([])).toEqual(ZERO_COST);
  });

  it("WB-5 a card's cost basis lists each basis its runs used", () => {
    expect(basesOf([subscription, metered, subscription])).toEqual(['metered', 'subscription']);
    expect(basesOf([subscription])).toEqual(['subscription']);
    expect(basesOf([])).toEqual([]);
  });
});

describe('the host of a card', () => {
  it("WB-5 a card's host follows its live run, else its holder's identity form", () => {
    const device = `agent:${person}/laptop`;
    expect(hostOf(item(`agent:${person}/laptop`), run({ outcome: 'running' }))).toBe(
      'workflow-run',
    );
    expect(hostOf(item('agent:builder'), subscription)).toBe('external-run');
    expect(hostOf(item(`human:${person}`), null)).toBe('person');
    expect(hostOf(item('agent:builder'), null)).toBe('workflow-run');
    expect(hostOf(item(device), null)).toBe('external-run');
    expect(hostOf(item(`${device} as builder via delegation:${metered.id}`), null)).toBe(
      'external-run',
    );
    expect(hostOf(item(null), null)).toBeNull();
  });
});
