import { eq } from 'drizzle-orm';
import type { DeclareJdMapCommand, ErrorReason, RemoveJdMapCommand } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { jdCascadeMap, jdCascadeMapAudit } from '@uw/db/schema';
import { cascadeNode } from './nodes.ts';

export type MapDone = { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

type MapRow = typeof jdCascadeMap.$inferSelect;

type Change = {
  readonly actor: Principal;
  readonly action: 'declare' | 'remove';
  readonly mapId: string;
  readonly before: MapRow | null;
  readonly after: MapRow | null;
  readonly traceId: string;
  readonly at: Date;
};

function snapshot(row: MapRow | null) {
  if (row === null) return null;
  return {
    jd_area: row.jdArea,
    cascade_page_id: row.cascadePageId,
    relation: row.relation,
    note: row.note,
    declared_by: row.declaredBy,
    declared_at: row.declaredAt.toISOString(),
  };
}

async function audit(tx: Executor, change: Change): Promise<void> {
  await tx.insert(jdCascadeMapAudit).values({
    actor: change.actor.identity,
    at: change.at,
    action: change.action,
    mapId: change.mapId,
    before: snapshot(change.before),
    after: snapshot(change.after),
    traceId: change.traceId,
  });
}

function orgAdmin(actor: Principal, at: Date): boolean {
  return can(actor, 'admin', { kind: 'org' }, at);
}

async function existing(db: Executor, command: DeclareJdMapCommand): Promise<MapRow | null> {
  const rows = await db.select().from(jdCascadeMap).where(eq(jdCascadeMap.jdArea, command.jdArea));
  const same = rows.find(
    (row) => row.cascadePageId === command.cascadePageId && row.relation === command.relation,
  );
  return same ?? null;
}

export async function declareJdMap(
  db: Database,
  actor: Principal,
  command: DeclareJdMapCommand,
  traceId: string,
  at: Date,
): Promise<MapDone> {
  if (!orgAdmin(actor, at)) return { ok: false, reason: 'not_permitted' };
  if ((await cascadeNode(db, command.cascadePageId)) === null) {
    return { ok: false, reason: 'cascade_node_not_found' };
  }
  await db.transaction(async (tx) => {
    const before = await existing(tx, command);
    const values = {
      id: before?.id ?? crypto.randomUUID(),
      jdArea: command.jdArea,
      cascadePageId: command.cascadePageId,
      relation: command.relation,
      note: command.note === null ? null : command.note.trim(),
      declaredBy: actor.identity,
      declaredAt: at,
    };
    const [after] = await tx
      .insert(jdCascadeMap)
      .values(values)
      .onConflictDoUpdate({
        target: [jdCascadeMap.jdArea, jdCascadeMap.cascadePageId, jdCascadeMap.relation],
        set: { note: values.note, declaredBy: values.declaredBy, declaredAt: at },
      })
      .returning();
    if (after === undefined) throw new Error('a declared map row reads back');
    await audit(tx, { actor, action: 'declare', mapId: after.id, before, after, traceId, at });
  });
  return { ok: true };
}

export async function removeJdMap(
  db: Database,
  actor: Principal,
  command: RemoveJdMapCommand,
  traceId: string,
  at: Date,
): Promise<MapDone> {
  if (!orgAdmin(actor, at)) return { ok: false, reason: 'not_permitted' };
  return db.transaction(async (tx) => {
    const [before] = await tx
      .delete(jdCascadeMap)
      .where(eq(jdCascadeMap.id, command.mapId))
      .returning();
    if (before === undefined) return { ok: false, reason: 'map_not_found' } as const;
    await audit(tx, {
      actor,
      action: 'remove',
      mapId: before.id,
      before,
      after: null,
      traceId,
      at,
    });
    return { ok: true } as const;
  });
}
