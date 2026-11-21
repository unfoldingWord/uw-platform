import { asc, eq } from 'drizzle-orm';
import { rowQuerySchema, type CollectionReply, type RowsReply } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { collectionTemplates } from '@uw/db/schema';
import { summaryOf, type StoredCollection } from './definitions.ts';
import { readRows, type Read } from './reader.ts';
import { viewById, viewsOf } from './view-rows.ts';

export async function collectionReply(
  db: Executor,
  stored: StoredCollection,
  actor: Principal,
  at: Date,
): Promise<CollectionReply> {
  const area = { kind: 'area', area: stored.definition.jdArea } as const;
  const views = await viewsOf(db, stored, actor.personId);
  const templates = await db
    .select({ id: collectionTemplates.id, name: collectionTemplates.name })
    .from(collectionTemplates)
    .where(eq(collectionTemplates.collectionId, stored.id))
    .orderBy(asc(collectionTemplates.position), asc(collectionTemplates.name));
  return {
    collection: summaryOf(stored),
    definition: stored.definition,
    views: views.map((view) => ({
      id: view.id,
      name: view.settings.name,
      layout: view.settings.layout,
      scope: view.settings.scope,
    })),
    templates,
    capabilities: {
      write: can(actor, 'write', area, at),
      admin: actor.kind === 'person' && can(actor, 'admin', area, at),
    },
  };
}

export type Page = {
  readonly viewId: string;
  readonly limit: number;
  readonly cursor: string | null;
};

export async function viewRows(
  db: Executor,
  stored: StoredCollection,
  actor: Principal,
  at: Date,
  page: Page,
): Promise<Read<RowsReply>> {
  const view = await viewById(db, stored, page.viewId);
  if (view === null || (view.ownerId !== null && view.ownerId !== actor.personId)) {
    return { ok: false, reason: 'view_not_found' };
  }
  const { filter, sorts, group } = view.settings;
  const query = rowQuerySchema.parse({
    filter,
    sorts,
    group,
    limit: page.limit,
    cursor: page.cursor,
  });
  return readRows(db, stored, actor, at, { query, view });
}
