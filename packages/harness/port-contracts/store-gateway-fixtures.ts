import {
  harnessSchema,
  identitySchema,
  itemStateSchema,
  stageSchema,
  type Harness,
  type ItemState,
  type Stage,
} from '@uw/contracts';
import type { GateDecisionRow, Store, StoreTransaction } from '../ports.ts';
import { storeRefusalOf } from '../port-errors.ts';

export const at = new Date('2026-10-01T09:00:00.000Z');
export const hour = 3_600_000;

export function uid(n: number): string {
  return `00000000-0000-4000-8000-${(0x5a0000000000 + n).toString(16)}`;
}

export function harnessOf(base: number, key: string, repository: string | null = null): Harness {
  return harnessSchema.parse({
    id: uid(base),
    key,
    template: 'software',
    jdArea: '80-89',
    repository,
    hostedBuilderEnabled: false,
    paused: false,
  });
}

export function stageOf(base: number, offset: number, key: string, position: number): Stage {
  const ship = key === 'ship';
  return stageSchema.parse({
    id: uid(base + offset),
    harnessId: uid(base),
    key,
    title: key,
    position,
    bracket: ship ? 'deploy_package' : 'build_package',
    agentPickup: ship ? 'none' : 'allowed',
    exitGate: ship ? 'human_approval' : 'checks',
    connector: ship ? 'merge' : 'none',
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    paused: false,
  });
}

export type Stages = { readonly build: Stage; readonly review: Stage; readonly ship: Stage };

export function stagesOf(base: number): Stages {
  return {
    build: stageOf(base, 1, 'build', 1),
    review: stageOf(base, 2, 'review', 2),
    ship: stageOf(base, 3, 'ship', 3),
  };
}

export async function seedHarness(
  tx: StoreTransaction,
  base: number,
  key: string,
): Promise<Stages> {
  await tx.harnesses.write.insert(harnessOf(base, key), at);
  const stages = stagesOf(base);
  await tx.harnessStages.write.insert(stages.build);
  await tx.harnessStages.write.insert(stages.review);
  await tx.harnessStages.write.insert(stages.ship);
  return stages;
}

export function itemOf(
  base: number,
  n: number,
  overrides: Readonly<Record<string, unknown>> = {},
): ItemState {
  return itemStateSchema.parse({
    itemId: uid(base + 10 + n),
    harnessId: uid(base),
    stageKey: 'build',
    title: `Item ${n}`,
    pageId: null,
    priority: 0,
    due: null,
    holder: null,
    claimantKind: null,
    delegationId: null,
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: null,
    riskTier: null,
    riskDomains: [],
    pullRequest: null,
    issue: null,
    zulipTopic: null,
    ...overrides,
  });
}

export function refusedBy(work: (tx: StoreTransaction) => Promise<unknown>, store: Store) {
  return store.transaction(work).then(() => null, storeRefusalOf);
}

export function decisionOf(
  base: number,
  n: number,
  actor: string,
  decidedAt: Date,
): GateDecisionRow {
  return {
    id: uid(base + 0x80 + n),
    harnessId: uid(base),
    itemId: uid(base + 11),
    stageId: uid(base + 2),
    actor: identitySchema.parse(actor),
    agentActor: null,
    delegationId: null,
    decision: 'approve',
    reason: null,
    evidence: { findings: [], gateTarget: null },
    traceId: uid(base + 0x90 + n),
    decidedAt,
  };
}

export async function seedDecisionItem(
  tx: StoreTransaction,
  base: number,
  key: string,
): Promise<void> {
  await seedHarness(tx, base, key);
  await tx.harnessItems.write.insert(itemOf(base, 1), at);
}
