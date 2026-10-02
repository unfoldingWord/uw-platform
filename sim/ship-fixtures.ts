import {
  ciJobSchema,
  type GateDecision,
  type HarnessEvent,
  type ItemState,
  type Principal,
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

export const shipPullRequest: PullRequestRef = { repo: 'unfoldingWord/uw-platform', number: 42 };

export const standardChange: ShipChange = {
  pullRequest: shipPullRequest,
  head: 'abc123',
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

export function approvedBy(reviewer: string, provider: string, commit: string): ReviewFact {
  return { reviewer, commit, state: 'approved', provider };
}

export function greenFacts(
  world: World,
  head: string,
  reviews: readonly ReviewFact[],
  ref: PullRequestRef = shipPullRequest,
): PullRequestFacts {
  return {
    ref,
    state: 'open',
    draft: false,
    head,
    checks: ciJobSchema.options.map((name) => ({ name, headSha: head, conclusion: 'success' })),
    reviews: [...reviews],
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
