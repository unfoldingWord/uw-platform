import { pullRequestRefSchema, type ItemState, type Principal } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { isImportPrincipal } from '../items/import.ts';
import {
  draft,
  readAllEvents,
  recordContext,
  recordItemEvents,
  type RecordContext,
} from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { FactsUnavailableError } from '../port-errors.ts';
import type { Ports, PullRequestFacts, PullRequestRef, StoreTransaction } from '../ports.ts';
import { lastShadowVerdict, sameVerdict, shadowVerdictOf } from './shadow-verdict.ts';

type ShadowPorts = Pick<Ports, 'clock' | 'githubFacts' | 'ids' | 'store'>;

export type ShadowInput = { readonly pullRequest: PullRequestRef };

type Seen = {
  readonly facts: PullRequestFacts | null;
  readonly pullRequest: PullRequestRef;
  readonly approver: Principal;
};

async function readFacts(
  ports: ShadowPorts,
  ref: PullRequestRef,
): Promise<PullRequestFacts | null> {
  try {
    return await ports.githubFacts.pullRequest(ref);
  } catch (error) {
    if (error instanceof FactsUnavailableError) return null;
    throw error;
  }
}

async function recordIn(
  tx: StoreTransaction,
  context: RecordContext,
  seen: Seen,
): Promise<readonly ItemState[]> {
  const harness = await tx.harnesses.read.byRepository(seen.pullRequest.repo);
  if (harness === null || !harness.shadow) return [];
  const found = await tx.harnessItems.read.byPullRequest(harness.id, seen.pullRequest);
  const item = found === null ? null : await tx.harnessItems.read.lock(found.itemId);
  if (item === null || item.gateStatus === 'done') return [];
  const events = await readAllEvents(tx, harness.id, item.itemId);
  const { facts, approver } = seen;
  const verdict = shadowVerdictOf({ facts, item, harness, events, approver, at: context.at });
  const last = lastShadowVerdict(events);
  if (last !== null && sameVerdict(last, verdict)) return [];
  const recorded = await recordItemEvents(tx, context, item.itemId, [
    draft('shadow_verdict', verdict),
  ]);
  return [recorded.item];
}

export async function recordShadowVerdicts(
  ports: ShadowPorts,
  caller: Caller,
  input: ShadowInput,
): Promise<KernelOutcome<readonly ItemState[]>> {
  const approver = caller.actor;
  if (!isImportPrincipal(approver)) return refused('not_permitted', { actor: approver.identity });
  if (!pullRequestRefSchema.safeParse(input.pullRequest).success) {
    return refused('malformed_command', { field: 'pullRequest' });
  }
  const facts = await readFacts(ports, input.pullRequest);
  const context = recordContext(ports, caller, ports.clock.now());
  const seen = { facts, pullRequest: input.pullRequest, approver };
  return accepted(await ports.store.transaction((tx) => recordIn(tx, context, seen)));
}
