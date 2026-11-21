import { and, eq } from 'drizzle-orm';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { collectionRequests } from '@uw/db/schema';
import { outcomeOf, type CollectionOutcome, type Command, type Done } from './outcome.ts';

async function replayed(
  tx: Transaction,
  actor: Principal,
  requestId: string,
): Promise<CollectionOutcome | null> {
  const [row] = await tx
    .select({ outcome: collectionRequests.outcome })
    .from(collectionRequests)
    .where(
      and(
        eq(collectionRequests.actor, actor.identity),
        eq(collectionRequests.requestId, requestId),
      ),
    );
  return row === undefined ? null : (row.outcome as CollectionOutcome);
}

class RolledBack extends Error {
  constructor(readonly outcome: CollectionOutcome) {
    super('a refused collection command writes nothing');
  }
}

export async function settle(
  db: Database,
  actor: Principal,
  command: Command,
  work: (tx: Transaction) => Promise<Done>,
): Promise<CollectionOutcome> {
  try {
    return await db.transaction((tx) => settleIn(tx, actor, command, work));
  } catch (error) {
    if (error instanceof RolledBack) return error.outcome;
    throw error;
  }
}

async function settleIn(
  tx: Transaction,
  actor: Principal,
  command: Command,
  work: (tx: Transaction) => Promise<Done>,
): Promise<CollectionOutcome> {
  const earlier = await replayed(tx, actor, command.requestId);
  if (earlier !== null) return earlier;
  const outcome = outcomeOf(command.requestId, await work(tx));
  if (outcome.status === 'error') throw new RolledBack(outcome);
  await tx.insert(collectionRequests).values({
    actor: actor.identity,
    requestId: command.requestId,
    command: command.command,
    outcome,
  });
  return outcome;
}
