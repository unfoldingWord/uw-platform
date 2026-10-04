import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PushSubscribe } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pushSubscriptions } from '@uw/db/schema';

const DEVICES_PER_PERSON = 20;

export type PushDevice = {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
};

type PersonDevices = {
  readonly devices: readonly PushDevice[];
  readonly expired: number;
};

export type PushStore = {
  subscribe(personId: string, input: PushSubscribe, at: Date): Promise<void>;
  unsubscribe(personId: string, endpoint: string): Promise<boolean>;
  devicesOf(personId: string, at: Date): Promise<PersonDevices>;
  prune(endpoint: string): Promise<void>;
  claimWindow(personId: string, rank: number, at: Date): Promise<boolean>;
};

async function keepNewest(db: Executor, personId: string): Promise<void> {
  const rows = await db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.personId, personId))
    .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.endpoint));
  const excess = rows.slice(0, Math.max(0, rows.length - DEVICES_PER_PERSON));
  if (excess.length === 0) return;
  await db.delete(pushSubscriptions).where(
    inArray(
      pushSubscriptions.endpoint,
      excess.map((row) => row.endpoint),
    ),
  );
}

async function subscribe(
  db: Executor,
  personId: string,
  input: PushSubscribe,
  at: Date,
): Promise<void> {
  const row = {
    personId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    expiresAt: input.expirationTime === null ? null : new Date(input.expirationTime),
    createdAt: at,
  };
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: input.endpoint, ...row })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row });
  await keepNewest(db, personId);
}

async function devicesOf(db: Executor, personId: string, at: Date): Promise<PersonDevices> {
  const expired = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.personId, personId), lte(pushSubscriptions.expiresAt, at)))
    .returning({ endpoint: pushSubscriptions.endpoint });
  const devices = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.personId, personId),
        or(isNull(pushSubscriptions.expiresAt), gt(pushSubscriptions.expiresAt, at)),
      ),
    )
    .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.endpoint));
  return { devices, expired: expired.length };
}

async function claimWindow(
  db: Executor,
  personId: string,
  rank: number,
  at: Date,
): Promise<boolean> {
  const rows = await db.execute(sql`
    INSERT INTO push_cooldowns (person_id, window_started_at, rank)
    VALUES (${personId}, ${at.toISOString()}, ${rank})
    ON CONFLICT (person_id) DO UPDATE
      SET window_started_at = EXCLUDED.window_started_at, rank = EXCLUDED.rank
      WHERE push_cooldowns.window_started_at <= EXCLUDED.window_started_at - interval '600 seconds'
         OR push_cooldowns.rank < EXCLUDED.rank
    RETURNING person_id
  `);
  return rows.length > 0;
}

export function pushStore(db: Executor): PushStore {
  return {
    subscribe: (personId, input, at) => subscribe(db, personId, input, at),
    unsubscribe: async (personId, endpoint) => {
      const removed = await db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.personId, personId), eq(pushSubscriptions.endpoint, endpoint)),
        )
        .returning({ endpoint: pushSubscriptions.endpoint });
      return removed.length > 0;
    },
    devicesOf: (personId, at) => devicesOf(db, personId, at),
    prune: async (endpoint) => {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    },
    claimWindow: (personId, rank, at) => claimWindow(db, personId, rank, at),
  };
}
