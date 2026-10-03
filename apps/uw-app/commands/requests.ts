import { and, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import {
  acceptedOutcomeSchema,
  errorOutcomeSchema,
  type CommandName,
  type Outcome,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { commandRequests } from '@uw/db/schema';

export const owns = ['command_requests'] as const;

type RequestKey = { readonly actor: string; readonly requestId: string };

type PriorRequest =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'settled';
      readonly command: string;
      readonly harnessId: string;
      readonly outcome: Outcome;
    }
  | {
      readonly kind: 'pending';
      readonly command: string;
      readonly harnessId: string;
      readonly claimedAt: Date;
    };

type Claim = {
  readonly command: CommandName;
  readonly harnessId: string;
  readonly traceId: string;
  readonly at: Date;
};

const RETAKE_AFTER_MS = 5 * 60 * 1000;

const storedOutcomeSchema = z.union([acceptedOutcomeSchema.strict(), errorOutcomeSchema.strict()]);

function keyed(key: RequestKey) {
  return and(eq(commandRequests.actor, key.actor), eq(commandRequests.requestId, key.requestId));
}

export async function priorRequest(db: Database, key: RequestKey): Promise<PriorRequest> {
  const [row] = await db.select().from(commandRequests).where(keyed(key));
  if (row === undefined) return { kind: 'none' };
  if (row.settledAt === null) {
    return {
      kind: 'pending',
      command: row.command,
      harnessId: row.harnessId,
      claimedAt: row.claimedAt,
    };
  }
  return {
    kind: 'settled',
    command: row.command,
    harnessId: row.harnessId,
    outcome: storedOutcomeSchema.parse(row.outcome),
  };
}

async function retake(db: Database, key: RequestKey, claim: Claim): Promise<boolean> {
  const staleBefore = new Date(claim.at.getTime() - RETAKE_AFTER_MS);
  const retaken = await db
    .update(commandRequests)
    .set({ claimedAt: claim.at, traceId: claim.traceId })
    .where(
      and(
        keyed(key),
        isNull(commandRequests.settledAt),
        eq(commandRequests.command, claim.command),
        eq(commandRequests.harnessId, claim.harnessId),
        lt(commandRequests.claimedAt, staleBefore),
      ),
    )
    .returning({ requestId: commandRequests.requestId });
  return retaken.length > 0;
}

export async function claimRequest(db: Database, key: RequestKey, claim: Claim): Promise<boolean> {
  const inserted = await db
    .insert(commandRequests)
    .values({
      actor: key.actor,
      requestId: key.requestId,
      command: claim.command,
      harnessId: claim.harnessId,
      outcome: null,
      traceId: claim.traceId,
      claimedAt: claim.at,
      settledAt: null,
    })
    .onConflictDoNothing()
    .returning({ requestId: commandRequests.requestId });
  return inserted.length > 0 || retake(db, key, claim);
}

export async function settleRequest(
  db: Database,
  key: RequestKey,
  outcome: Outcome,
  at: Date,
): Promise<void> {
  const stored = storedOutcomeSchema.parse(outcome);
  await db
    .update(commandRequests)
    .set({ outcome: stored, settledAt: at })
    .where(and(keyed(key), isNull(commandRequests.settledAt)));
}

export async function releaseRequest(
  db: Database,
  key: RequestKey,
  traceId: string,
): Promise<void> {
  await db
    .delete(commandRequests)
    .where(
      and(keyed(key), isNull(commandRequests.settledAt), eq(commandRequests.traceId, traceId)),
    );
}
