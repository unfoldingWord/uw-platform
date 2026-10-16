import {
  shadowComparisonSchema,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type ShadowComparison,
} from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { FactsUnavailableError } from '../port-errors.ts';
import type { Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { readableHarness } from '../reads/scene.ts';
import { comparisonRows } from './shadow-rows.ts';
import { VIEW_LIMIT } from './types.ts';

type ShadowPorts = Pick<Ports, 'githubFacts' | 'grants' | 'store'>;
type Read = {
  readonly harness: Harness;
  readonly events: readonly HarnessEvent[];
  readonly items: readonly ItemState[];
};

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function readIn(
  ports: ShadowPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string; readonly at: Date },
): Promise<KernelOutcome<Read>> {
  const harness = isAgent(caller.actor)
    ? null
    : await readableHarness(ports, tx, caller, input.harnessId, input.at);
  if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
  const events = await tx.harnessEvents.read.recent({
    since: new Date(input.at.getTime() - WINDOW_MS),
    names: ['shadow_verdict', 'review_verdict_recorded'],
    agentsOnly: false,
    limit: VIEW_LIMIT,
    harnessIds: [harness.id],
  });
  const itemIds = [
    ...new Set(events.flatMap((event) => (event.itemId === null ? [] : [event.itemId]))),
  ];
  return accepted({ harness, events, items: await tx.harnessItems.read.byIds(itemIds) });
}

async function factsOf(ports: ShadowPorts, item: ItemState): Promise<PullRequestFacts | null> {
  if (item.pullRequest === null) return null;
  try {
    return await ports.githubFacts.pullRequest(item.pullRequest);
  } catch (error) {
    if (error instanceof FactsUnavailableError) return null;
    throw error;
  }
}

export async function shadowComparison(
  ports: ShadowPorts,
  caller: Caller,
  input: { readonly harnessId: string },
  at: Date,
): Promise<KernelOutcome<ShadowComparison>> {
  const read = await ports.store.transaction((tx) =>
    readIn(ports, tx, caller, { harnessId: input.harnessId, at }),
  );
  if (read.status !== 'accepted') return read;
  const { harness, events, items } = read.value;
  const facts = new Map<string, PullRequestFacts | null>();
  for (const item of items) facts.set(item.itemId, await factsOf(ports, item));
  return accepted(
    shadowComparisonSchema.parse({
      harnessId: harness.id,
      harnessKey: harness.key,
      shadow: harness.shadow,
      capped: events.length === VIEW_LIMIT,
      rows: comparisonRows({ events, items, facts }),
    }),
  );
}
