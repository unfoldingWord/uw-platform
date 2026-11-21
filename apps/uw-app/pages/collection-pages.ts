import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { JdArea, Page, PageType } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Transaction } from '@uw/db/client';
import { pageLinks, pages } from '@uw/db/schema';
import { rebuildLinks, resolveBody } from './links.ts';
import { snapshot, toPage } from './store.ts';

export type NewCollectionPage = {
  readonly pageId: string;
  readonly collectionId: string;
  readonly type: PageType;
  readonly jdArea: JdArea;
  readonly slug: string;
  readonly title: string;
  readonly frontmatter: Record<string, unknown>;
  readonly bodyMd: string;
};

export type WriteSource = {
  readonly actor: Principal;
  readonly traceId: string;
  readonly requestId: string | null;
  readonly at: Date;
};

export async function createCollectionPage(
  tx: Transaction,
  page: NewCollectionPage,
  source: WriteSource,
): Promise<Page> {
  const bodyMd = await resolveBody(
    tx,
    source.actor,
    { bodyMd: page.bodyMd, area: page.jdArea },
    source.at,
  );
  const [row] = await tx
    .insert(pages)
    .values({
      id: page.pageId,
      type: page.type,
      jdArea: page.jdArea,
      slug: page.slug,
      title: page.title,
      parentId: null,
      collectionId: page.collectionId,
      frontmatter: page.frontmatter,
      bodyMd,
      version: 1,
      status: 'active',
      createdAt: source.at,
      updatedAt: source.at,
    })
    .returning();
  if (!row) throw new Error('an inserted collection page must return its row');
  await snapshot(tx, row, source.actor, source);
  await rebuildLinks(tx, page.pageId, bodyMd);
  return toPage(row);
}

export type CollectionPageRow = Page & { readonly collectionId: string | null };

export async function lockedCollectionPage(
  tx: Transaction,
  pageId: string,
): Promise<CollectionPageRow | null> {
  const [row] = await tx.select().from(pages).where(eq(pages.id, pageId)).for('update');
  if (!row) return null;
  return { ...toPage(row), collectionId: row.collectionId };
}

export type PageChange = {
  readonly title?: string;
  readonly frontmatter?: Record<string, unknown>;
};

export async function writeCollectionPage(
  tx: Transaction,
  stored: Page,
  change: PageChange,
  source: WriteSource,
): Promise<Page> {
  const [row] = await tx
    .update(pages)
    .set({
      title: change.title ?? stored.title,
      frontmatter: change.frontmatter ?? stored.frontmatter,
      version: stored.version + 1,
      updatedAt: source.at,
    })
    .where(and(eq(pages.id, stored.id), eq(pages.version, stored.version)))
    .returning();
  if (!row) throw new Error('a locked collection page keeps its version until written');
  await snapshot(tx, row, source.actor, source);
  return toPage(row);
}

export async function setRelationLinks(
  tx: Transaction,
  fromPage: string,
  rel: string,
  targets: readonly string[],
): Promise<void> {
  await tx.delete(pageLinks).where(and(eq(pageLinks.fromPage, fromPage), eq(pageLinks.rel, rel)));
  if (targets.length === 0) return;
  await tx.insert(pageLinks).values(
    targets.map((toPage, index) => ({
      fromPage,
      toPage,
      rel,
      wanted: null,
      position: String(index).padStart(4, '0'),
    })),
  );
}

export async function relationTargets(
  tx: Transaction,
  fromPage: string,
  rel: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: pageLinks.toPage })
    .from(pageLinks)
    .where(and(eq(pageLinks.fromPage, fromPage), eq(pageLinks.rel, rel)))
    .orderBy(asc(pageLinks.position));
  return rows.flatMap((row) => (row.id === null ? [] : [row.id]));
}

export async function areasOfPagesIn(
  tx: Transaction,
  collectionId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, JdArea>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: pages.id, area: pages.jdArea })
    .from(pages)
    .where(
      and(
        eq(pages.collectionId, collectionId),
        inArray(pages.id, [...ids]),
        ne(pages.status, 'retired'),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.area]));
}

export async function reverseSources(
  tx: Transaction,
  toPage: string,
  rel: string,
): Promise<ReadonlyMap<string, JdArea>> {
  const rows = await tx
    .select({ id: pages.id, area: pages.jdArea })
    .from(pageLinks)
    .innerJoin(pages, eq(pages.id, pageLinks.fromPage))
    .where(and(eq(pageLinks.toPage, toPage), eq(pageLinks.rel, rel)));
  return new Map(rows.map((row) => [row.id, row.area]));
}

export async function pagesOfCollection(
  tx: Transaction,
  collectionId: string,
): Promise<readonly Page[]> {
  const rows = await tx
    .select()
    .from(pages)
    .where(eq(pages.collectionId, collectionId))
    .orderBy(pages.id)
    .for('update');
  return rows.map(toPage);
}

export async function rewriteFrontmatterKey(
  tx: Transaction,
  page: Page,
  key: string,
  value: unknown,
  source: WriteSource,
): Promise<Page> {
  const kept = Object.entries(page.frontmatter).filter(([name]) => name !== key);
  const added = value === null || value === undefined ? [] : [[key, value] as const];
  const next = Object.fromEntries([...kept, ...added]);
  return writeCollectionPage(tx, page, { frontmatter: next }, source);
}

export async function setReverseLinks(
  tx: Transaction,
  toPage: string,
  rel: string,
  change: { readonly sources: readonly string[]; readonly single: boolean },
): Promise<void> {
  await tx.delete(pageLinks).where(and(eq(pageLinks.toPage, toPage), eq(pageLinks.rel, rel)));
  if (change.sources.length === 0) return;
  if (change.single) {
    await tx
      .delete(pageLinks)
      .where(and(inArray(pageLinks.fromPage, [...change.sources]), eq(pageLinks.rel, rel)));
  }
  await tx
    .insert(pageLinks)
    .values(
      change.sources.map((fromPage) => ({ fromPage, toPage, rel, wanted: null, position: '0000' })),
    );
}
