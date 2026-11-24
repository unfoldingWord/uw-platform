import { randomUUID } from 'node:crypto';
import type { CollectionDefinition, Principal, RowQuery } from '@uw/contracts';
import { rowQuerySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { createCollection, type Request } from '../collections/definition-commands.ts';
import { loadCollection } from '../collections/definitions.ts';
import type { CollectionOutcome } from '../collections/outcome.ts';
import { readRows } from '../collections/reader.ts';
import { createRow } from '../collections/rows.ts';
import { personOn } from './kernel.ts';

export const collectionsAt = new Date('2026-11-21T12:00:00.000Z');
const granted = new Date('2026-01-01T00:00:00.000Z');

type Grant = { readonly role: 'admin' | 'editor' | 'viewer'; readonly area: string | null };

let serial = 0;

export async function personWith(
  db: Database,
  name: string,
  grants: readonly Grant[],
): Promise<Principal> {
  serial += 1;
  const id = randomUUID();
  const email = `${name}.${serial}@unfoldingword.org`;
  await seedPerson(db, { id, email });
  for (const grant of grants) {
    await seedGrant(db, {
      id: randomUUID(),
      personId: id,
      role: grant.role,
      scopeKind: grant.area === null ? 'org' : 'jd_area',
      scopeArea: grant.area,
      grantedAt: granted,
      expiresAt: null,
    });
  }
  return personOn(db, id, email, collectionsAt);
}

export function requestOf(actor: Principal, at: Date = collectionsAt): Request {
  return { actor, traceId: randomUUID(), at, newId: () => randomUUID() };
}

export function accepted(outcome: CollectionOutcome): void {
  if (outcome.status !== 'accepted')
    throw new Error(`refused: ${outcome.reason} ${JSON.stringify(outcome)}`);
}

export async function defined(
  db: Database,
  actor: Principal,
  definition: CollectionDefinition,
): Promise<void> {
  accepted(
    await createCollection(
      db,
      { command: 'create_collection', requestId: randomUUID(), definition },
      requestOf(actor),
    ),
  );
}

export async function rowIn(
  db: Database,
  actor: Principal,
  row: {
    readonly collection: string;
    readonly jdArea: string;
    readonly title: string;
    readonly values?: Record<string, unknown>;
  },
): Promise<string> {
  const rowId = randomUUID();
  const outcome = await createRow(
    db,
    {
      command: 'create_row',
      requestId: randomUUID(),
      rowId,
      template: null,
      values: (row.values ?? {}) as Record<string, never>,
      collection: row.collection,
      jdArea: row.jdArea,
      title: row.title,
    },
    requestOf(actor),
  );
  accepted(outcome);
  return rowId;
}

export async function query(
  db: Database,
  actor: Principal,
  key: string,
  raw: Partial<RowQuery> = {},
  at: Date = collectionsAt,
) {
  const stored = await loadCollection(db, key);
  if (stored === null) throw new Error(`no collection ${key}`);
  return readRows(db, stored, actor, at, { query: rowQuerySchema.parse(raw), view: null });
}

export async function titles(
  db: Database,
  actor: Principal,
  key: string,
  raw: Partial<RowQuery> = {},
) {
  const read = await query(db, actor, key, raw);
  if (!read.ok) throw new Error(`refused: ${read.reason}`);
  return read.value.rows.map((row) => row.title);
}

export async function replyOf(
  db: Database,
  actor: Principal,
  key: string,
  raw: Partial<RowQuery> = {},
) {
  const read = await query(db, actor, key, raw);
  if (!read.ok) throw new Error(`refused: ${read.reason}`);
  return read.value;
}
