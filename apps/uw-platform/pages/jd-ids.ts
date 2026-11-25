import { and, ne, or, sql } from 'drizzle-orm';
import { jdIdOfTitle, type JdCategory } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';

const filedIn = sql<string>`${pages.frontmatter}->>'jd_category'`;
const numbered = sql<string | null>`${pages.frontmatter}->>'jd_id'`;

export async function takenJdIds(db: Executor, category: JdCategory): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ jdId: numbered, title: pages.title })
    .from(pages)
    .where(
      and(
        or(sql`${filedIn} = ${category}`, sql`${pages.title} ~ ${`^\\s*${category}\\.`}`),
        ne(pages.status, 'retired'),
      ),
    );
  const taken = new Set<string>();
  for (const row of rows) {
    if (row.jdId !== null) taken.add(row.jdId);
    const titled = jdIdOfTitle(row.title);
    if (titled !== null) taken.add(titled);
  }
  return taken;
}
