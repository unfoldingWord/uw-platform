import { and, asc, eq, ne } from 'drizzle-orm';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageFavourites, pages } from '@uw/db/schema';
import { areaFilter } from './reads.ts';
import { readPage } from './store.ts';

const MOST_SHOWN = 100;

export async function setFavourite(
  db: Executor,
  actor: Principal,
  favourite: { readonly pageId: string; readonly on: boolean },
  at: Date,
): Promise<boolean | null> {
  const page = await readPage(db, actor, favourite.pageId, at);
  if (page === null || actor.personId === null) return null;
  const key = and(eq(pageFavourites.personId, actor.personId), eq(pageFavourites.pageId, page.id));
  if (!favourite.on) {
    await db.delete(pageFavourites).where(key);
    return false;
  }
  await db
    .insert(pageFavourites)
    .values({ personId: actor.personId, pageId: page.id, createdAt: at })
    .onConflictDoNothing();
  return true;
}

export async function isFavourite(
  db: Executor,
  actor: Principal,
  pageId: string,
): Promise<boolean> {
  if (actor.personId === null) return false;
  const rows = await db
    .select({ pageId: pageFavourites.pageId })
    .from(pageFavourites)
    .where(and(eq(pageFavourites.personId, actor.personId), eq(pageFavourites.pageId, pageId)));
  return rows.length > 0;
}

export async function favouritesOf(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly { readonly id: string; readonly title: string }[]> {
  const areas = areaFilter(actor, at);
  if (areas === null || actor.personId === null) return [];
  return db
    .select({ id: pages.id, title: pages.title })
    .from(pageFavourites)
    .innerJoin(pages, eq(pages.id, pageFavourites.pageId))
    .where(and(eq(pageFavourites.personId, actor.personId), areas, ne(pages.status, 'retired')))
    .orderBy(asc(pages.title))
    .limit(MOST_SHOWN);
}
