import { eventSchema, harnessSchema, type Harness, type HarnessEvent } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { Delegation, GrantHolder, StoreTransaction } from '../ports.ts';
import { planWakes, type WakePlanPorts } from './plan.ts';

const at = new Date('2026-10-03T09:00:00.000Z');
const person = '00000000-0000-4000-8000-000000000305';
const areaAdmin = '00000000-0000-4000-8000-000000000306';
const harnessId = '00000000-0000-4000-8000-0000000003a1';
const delegationId = '00000000-0000-4000-8000-0000000003d1';

function harnessOf(personId: string | null): Harness {
  return harnessSchema.parse({
    id: harnessId,
    key: personId === null ? 'software' : `assistant-${person}`,
    title: 'Harness',
    template: personId === null ? 'software' : 'assistant',
    jdArea: '90-99',
    repository: null,
    hostedBuilderEnabled: false,
    paused: false,
    shadow: false,
    externalReviewerIdentities: [],
    frozen: false,
    freezeAllow: [],
    requiredChecks: [],
    protectedPaths: [],
    fixClaim: false,
    botAuthors: [],
    personId,
  });
}

const delegation: Delegation = {
  id: delegationId,
  personId: person,
  persona: 'agent:builder' as Delegation['persona'],
  harnessId,
  capability: 'assist',
  maxTier: null,
  grantedAt: at,
  expiresAt: at,
  revokedAt: null,
  lapsedAt: at,
  supersedes: null,
};

const lapse: HarnessEvent = eventSchema.parse({
  eventId: '00000000-0000-4000-8000-0000000003e1',
  harnessId,
  itemId: null,
  name: 'delegation_lapsed',
  at: at.toISOString(),
  actor: 'human:00000000-0000-4000-8000-000000000305',
  evidence: { delegationId, why: 'expired' },
  traceId: '00000000-0000-4000-8000-0000000003f1',
  position: 1,
});

const holders: readonly GrantHolder[] = [
  {
    personId: areaAdmin,
    email: 'admin@example.org',
    grants: [
      {
        grantId: areaAdmin,
        role: 'admin',
        scopeKind: 'jd_area',
        scopeArea: '90-99',
        expiresAt: null,
      },
    ],
  },
];

function portsFor(harness: Harness): WakePlanPorts {
  const tx = {
    harnesses: { read: { byId: async () => harness } },
    harnessItems: { read: { byId: async () => null } },
    harnessRuns: { read: { byId: async () => null } },
    delegations: { read: { byId: async () => delegation } },
  } as unknown as StoreTransaction;
  return {
    clock: { now: () => at },
    store: { appliedMigrations: async () => [], transaction: async (work) => work(tx) },
    grants: { holders: async () => holders } as unknown as WakePlanPorts['grants'],
    hub: { wake: async () => undefined, present: async () => false },
  };
}

describe('PA-1 a wake on a personal harness goes only to its person', () => {
  it('names the person alone and marks the wake personal', async () => {
    const [planned] = await planWakes(portsFor(harnessOf(person)), [lapse]);
    expect(planned?.wake.recipients.map((recipient) => recipient.personId)).toEqual([person]);
    expect(planned?.wake.personal).toBe(true);
  });

  it('keeps the area admins for a workflow harness, which is not personal', async () => {
    const [planned] = await planWakes(portsFor(harnessOf(null)), [lapse]);
    expect(planned?.wake.recipients.map((recipient) => recipient.personId)).toEqual([areaAdmin]);
    expect(planned?.wake.personal).toBe(false);
  });
});
