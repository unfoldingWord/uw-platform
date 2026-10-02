import {
  ciJobSchema,
  type GateDecision,
  type HarnessEvent,
  type ItemState,
  type Principal,
  type PullRequestDeclaration,
  type RiskDeclaration,
} from '@uw/contracts';
import {
  readAllEvents,
  type KernelOutcome,
  type PullRequestFacts,
  type PullRequestRef,
  type ReviewFact,
} from '@uw/harness';
import { simAdvance, simAgent, simCaller } from './fixtures.ts';
import type { World } from './world.ts';

export type ShipChange = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly paths: readonly string[];
  readonly declaration: RiskDeclaration | null;
};

export type ShipInput = {
  readonly harnessId: string;
  readonly editor: Principal;
  readonly title: string;
  readonly change: ShipChange;
};

export function simSha(seed: string): string {
  return seed.padEnd(40, '0');
}

export const shipPullRequest: PullRequestRef = { repo: 'unfoldingWord/uw-platform', number: 42 };

export const standardChange: ShipChange = {
  pullRequest: shipPullRequest,
  head: simSha('abc123'),
  paths: ['apps/uw-app/board.tsx'],
  declaration: { riskTier: 'standard', riskDomains: [] },
};

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function submitWithChange(
  world: World,
  worker: Principal,
  itemId: string,
  change: ShipChange | null,
): Promise<ItemState> {
  const caller = simCaller(world, worker);
  accepted(await world.kernel.items.claim(caller, { itemId, delegationId: null }), 'claim');
  const submitted = await world.kernel.items.submit(caller, {
    itemId,
    to: null,
    evidence: {},
    change,
  });
  return accepted(submitted, 'submit').item;
}

export async function simParkedAtShip(world: World, input: ShipInput): Promise<ItemState> {
  const editor = simCaller(world, input.editor);
  const { itemId } = accepted(
    await world.kernel.items.enqueue(editor, {
      harnessId: input.harnessId,
      title: input.title,
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
  const { harnessId } = input;
  await simAdvance(world, { harnessId, itemId, worker: input.editor, through: ['package'] });
  const agent = simAgent(input.editor, `${input.editor.personId}/builder`, { interactive: true });
  await simAdvance(world, { harnessId, itemId, worker: agent, through: ['scope', 'plan'] });
  await submitWithChange(world, agent, itemId, input.change);
  await submitWithChange(world, agent, itemId, input.change);
  const parked = await submitWithChange(world, input.editor, itemId, null);
  if (parked.stageKey !== 'ship' || parked.gateStatus !== 'parked') {
    throw new Error(`the item is ${parked.gateStatus} at ${parked.stageKey}, not parked at ship`);
  }
  return parked;
}

export function approvedBy(
  login: string,
  provider: string | null,
  commit: string,
  reviewId: number,
  submittedAt: Date | null = null,
): ReviewFact {
  return { reviewId, reviewer: login, commit, state: 'approved', provider, submittedAt };
}

export type FactsInput = {
  readonly itemId: string;
  readonly head: string;
  readonly reviews: readonly ReviewFact[];
  readonly ref?: PullRequestRef;
  readonly paths?: readonly string[];
  readonly declaration?: PullRequestDeclaration | null;
};

const standardDeclaration: PullRequestDeclaration = {
  closes: [],
  risks: 'none known',
  touches: 'the board',
  riskTier: 'standard',
  riskDomains: [],
};

export function greenFacts(world: World, input: FactsInput): PullRequestFacts {
  const { head } = input;
  return {
    ref: input.ref ?? shipPullRequest,
    state: 'open',
    draft: false,
    head,
    headRef: `harness/${input.itemId}`,
    checks: ciJobSchema.options.map((name, index) => ({
      checkId: 9100000001 + index,
      name,
      headSha: head,
      app: 'github-actions',
      conclusion: 'success',
    })),
    reviews: [...input.reviews],
    files: { head, paths: [...(input.paths ?? ['apps/uw-app/board.tsx'])] },
    declaration: input.declaration === undefined ? standardDeclaration : input.declaration,
    freshAt: world.adapters.clock.now(),
  };
}

export type ItemLog = {
  readonly events: readonly HarnessEvent[];
  readonly decisions: readonly GateDecision[];
};

export function itemLog(world: World, harnessId: string, itemId: string): Promise<ItemLog> {
  return world.adapters.store.transaction(async (tx) => ({
    events: await readAllEvents(tx, harnessId, itemId),
    decisions: (await tx.gateDecisions.read.forItem(itemId)).map((row) => row.decision),
  }));
}

export function namesSince(before: ItemLog, after: ItemLog): readonly string[] {
  return after.events.slice(before.events.length).map((event) => event.name);
}
