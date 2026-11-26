import type { Grant, Harness, Identity } from '@uw/contracts';
import { livenessOf, recordLapse } from '../delegations/live.ts';
import type { RecordContext } from '../items/record.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';

export type LiveAssist = { readonly delegation: Delegation; readonly grants: readonly Grant[] };

type LivenessPorts = Pick<Ports, 'grants'>;

const EPOCH = new Date(0);

async function lapsedUnlessLive(
  tx: StoreTransaction,
  ports: LivenessPorts,
  context: RecordContext,
  delegation: Delegation,
): Promise<LiveAssist | null> {
  const liveness = await livenessOf(tx, ports, delegation, context.at);
  if (liveness.live) return { delegation: liveness.delegation, grants: liveness.grants };
  if (liveness.why !== null) await recordLapse(tx, context, delegation, liveness.why);
  return null;
}

async function latestGranted(tx: StoreTransaction, harnessId: string): Promise<Delegation | null> {
  const [granted] = await tx.harnessEvents.read.recent({
    since: EPOCH,
    names: ['delegation_granted'],
    agentsOnly: false,
    limit: 1,
    harnessIds: [harnessId],
  });
  const delegationId = granted?.evidence['delegationId'];
  if (typeof delegationId !== 'string') return null;
  return tx.delegations.read.byId(delegationId);
}

function assistsOn(delegation: Delegation, harness: Harness, persona: Identity): boolean {
  return (
    delegation.capability === 'assist' &&
    delegation.harnessId === harness.id &&
    delegation.persona === persona &&
    delegation.personId === harness.personId
  );
}

export async function liveAssist(
  tx: StoreTransaction,
  ports: LivenessPorts,
  context: RecordContext,
  harness: Harness,
  persona: Identity,
): Promise<LiveAssist | null> {
  const filter = { personId: harness.personId, persona, harnessId: harness.id };
  const candidates = await tx.delegations.read.live(filter, context.at);
  for (const delegation of candidates.filter((found) => assistsOn(found, harness, persona))) {
    const live = await lapsedUnlessLive(tx, ports, context, delegation);
    if (live !== null) return live;
  }
  const latest = await latestGranted(tx, harness.id);
  if (latest !== null && assistsOn(latest, harness, persona)) {
    await lapsedUnlessLive(tx, ports, context, latest);
  }
  return null;
}
