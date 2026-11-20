import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { areaFilter } from './reads.ts';

export const TEMPLATE_TAG = 'template';

const MOST_TEMPLATES = 100;

export async function templatesFor(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly { readonly id: string; readonly title: string }[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const tagged = JSON.stringify({ tags: [TEMPLATE_TAG] });
  return db
    .select({ id: pages.id, title: pages.title })
    .from(pages)
    .where(
      and(
        areas,
        eq(pages.type, 'knowledge'),
        ne(pages.status, 'retired'),
        sql`${pages.frontmatter} @> ${tagged}::jsonb`,
      ),
    )
    .orderBy(asc(pages.title))
    .limit(MOST_TEMPLATES);
}
