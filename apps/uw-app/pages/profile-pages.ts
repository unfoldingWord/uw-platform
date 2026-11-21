import { and, eq } from 'drizzle-orm';
import type { Page } from '@uw/contracts';
import { DIRECTORY_AREA } from '@uw/core/acl';
import type { Transaction } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { createCollectionPage, type WriteSource } from './collection-pages.ts';
import { embedsItself, rebuildLinks, resolveBody } from './links.ts';
import { snapshot, toPage } from './store.ts';

const PROFILE = 'profile';

export type NewProfilePage = {
  readonly pageId: string;
  readonly collectionId: string;
  readonly personId: string;
  readonly title: string;
  readonly bodyMd: string;
};

export function createProfilePage(
  tx: Transaction,
  page: NewProfilePage,
  source: WriteSource,
): Promise<Page> {
  return createCollectionPage(
    tx,
    {
      pageId: page.pageId,
      collectionId: page.collectionId,
      type: PROFILE,
      jdArea: DIRECTORY_AREA,
      slug: `profile-${page.personId}`,
      title: page.title,
      frontmatter: {},
      bodyMd: page.bodyMd,
    },
    source,
  );
}

export type ProfileWrite =
  | { readonly ok: true; readonly page: Page }
  | { readonly ok: false; readonly reason: 'page_not_found' | 'stale_version' | 'embed_cycle' };

export async function writeProfileBody(
  tx: Transaction,
  change: { readonly pageId: string; readonly expectedVersion: number; readonly bodyMd: string },
  source: WriteSource,
): Promise<ProfileWrite> {
  const [stored] = await tx.select().from(pages).where(eq(pages.id, change.pageId)).for('update');
  if (stored?.type !== PROFILE) return { ok: false, reason: 'page_not_found' };
  if (stored.version !== change.expectedVersion) return { ok: false, reason: 'stale_version' };
  const area = { bodyMd: change.bodyMd, area: stored.jdArea };
  const bodyMd = await resolveBody(tx, source.actor, area, source.at);
  if (await embedsItself(tx, stored.id, bodyMd)) return { ok: false, reason: 'embed_cycle' };
  const [row] = await tx
    .update(pages)
    .set({ bodyMd, version: stored.version + 1, updatedAt: source.at })
    .where(and(eq(pages.id, stored.id), eq(pages.version, stored.version)))
    .returning();
  if (!row) throw new Error('a locked profile page keeps its version until written');
  await snapshot(tx, row, source.actor, source);
  await rebuildLinks(tx, stored.id, bodyMd);
  return { ok: true, page: toPage(row) };
}
