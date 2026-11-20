import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages, people } from '@uw/db/schema';
import { areaFilter } from './reads.ts';

export type Verification =
  { readonly state: 'never' } | { readonly state: 'verified' | 'lapsed'; readonly until: string };

export type LapsedPage = {
  readonly id: string;
  readonly title: string;
  readonly category: string | null;
  readonly owner: string | null;
  readonly until: string;
};

const LISTED = 'knowledge';
const MOST_LISTED = 500;
const until = sql<string>`${pages.frontmatter}->>'verified_until'`;

export function verificationOf(
  frontmatter: Readonly<Record<string, unknown>>,
  at: Date,
): Verification {
  const date = frontmatter['verified_until'];
  if (typeof date !== 'string') return { state: 'never' };
  return { state: date < formatDate(at) ? 'lapsed' : 'verified', until: date };
}

export async function lapsedPages(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly LapsedPage[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  return db
    .select({
      id: pages.id,
      title: pages.title,
      category: sql<string | null>`${pages.frontmatter}->>'jd_category'`,
      owner: people.displayName,
      until,
    })
    .from(pages)
    .leftJoin(people, sql`${pages.frontmatter}->>'owner' = 'human:' || ${people.id}::text`)
    .where(
      and(
        areas,
        eq(pages.type, LISTED),
        ne(pages.status, 'retired'),
        sql`${until} < ${formatDate(at)}`,
      ),
    )
    .orderBy(asc(until), asc(pages.title))
    .limit(MOST_LISTED);
}
