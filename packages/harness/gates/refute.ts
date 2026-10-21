import { eventEvidenceSchemas, type EventEvidence, type HarnessEvent } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import {
  draft,
  readAllEvents,
  recordContext,
  recordItemEvents,
  type RecordContext,
} from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';

type RefutePorts = Pick<Ports, 'clock' | 'ids' | 'store'>;
type Review = NonNullable<EventEvidence['run_completed']['review']>;
type Found = { readonly persona: HarnessEvent['actor']; readonly review: Review };

export type RefuteInput = {
  readonly itemId: string;
  readonly runId: string;
  readonly finding: number;
};
export type Refuted = { readonly recorded: boolean };

const FINDING_INDEX_LIMIT = 49;

function reviewOf(events: readonly HarnessEvent[], runId: string): Found | null {
  for (const event of events) {
    if (event.name !== 'run_completed') continue;
    const evidence = eventEvidenceSchemas.run_completed.parse(event.evidence);
    if (evidence.runId === runId && evidence.review !== null) {
      return { persona: event.actor, review: evidence.review };
    }
  }
  return null;
}

function marked(events: readonly HarnessEvent[], input: RefuteInput): boolean {
  return events.some(
    (event) =>
      event.name === 'finding_refuted' &&
      event.evidence['runId'] === input.runId &&
      event.evidence['index'] === input.finding,
  );
}

async function refuteIn(
  tx: StoreTransaction,
  context: RecordContext,
  caller: Caller,
  input: RefuteInput,
): Promise<KernelOutcome<Refuted>> {
  const item = await tx.harnessItems.read.lock(input.itemId);
  const harness = item === null ? null : await tx.harnesses.read.byId(item.harnessId);
  if (item === null || harness === null) return refused('item_not_found', { itemId: input.itemId });
  if (!allowed(caller.actor, 'write', harness, context.at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const found = reviewOf(events, input.runId);
  const finding = found?.review.findings[input.finding];
  if (found === null || finding === undefined) {
    return refused('malformed_command', { field: 'finding' });
  }
  if (marked(events, input)) return accepted({ recorded: false });
  const evidence = {
    runId: input.runId,
    persona: found.persona,
    reviewer: found.review.reviewer,
    index: input.finding,
    ...finding,
  };
  await recordItemEvents(tx, context, item.itemId, [draft('finding_refuted', evidence)]);
  return accepted({ recorded: true });
}

export function refuteFinding(
  ports: RefutePorts,
  caller: Caller,
  input: RefuteInput,
): Promise<KernelOutcome<Refuted>> {
  if (isAgent(caller.actor) || caller.actor.personId === null) {
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  }
  const index = input.finding;
  if (!Number.isInteger(index) || index < 0 || index > FINDING_INDEX_LIMIT) {
    return Promise.resolve(refused('malformed_command', { field: 'finding' }));
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) => refuteIn(tx, context, caller, input));
}
