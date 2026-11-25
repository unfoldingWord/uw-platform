import { and, ne, or, sql } from 'drizzle-orm';
import { jdIdOfTitle, knowledgeFrontmatterSchema, type JdCategory, type Page } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';

const filedIn = sql<string>`${pages.frontmatter}->>'jd_category'`;
const numbered = sql<string | null>`${pages.frontmatter}->>'jd_id'`;

type JdRefusal = 'jd_taken' | 'jd_category';

export async function takenJdIds(
  db: Executor,
  category: JdCategory,
  except?: string,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ jdId: numbered, title: pages.title })
    .from(pages)
    .where(
      and(
        or(sql`${filedIn} = ${category}`, sql`${pages.title} ~ ${`^\\s*${category}\\.`}`),
        ne(pages.status, 'retired'),
        except === undefined ? undefined : ne(pages.id, except),
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

export type Renumbered =
  | { readonly ok: true; readonly frontmatter: Page['frontmatter'] }
  | { readonly ok: false; readonly reason: JdRefusal };

function unnumbered(page: Page, held: string | null): Renumbered {
  const inStep = held !== null && jdIdOfTitle(page.title) === held;
  return { ok: true, frontmatter: { ...page.frontmatter, jd_id: inStep ? null : held } };
}

export async function renumbered(db: Executor, page: Page, title: string): Promise<Renumbered> {
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  if (page.type !== 'knowledge' || !filed.success)
    return { ok: true, frontmatter: page.frontmatter };
  const { jd_category: category, jd_id: held } = filed.data;
  const number = jdIdOfTitle(title);
  if (number === null) return unnumbered(page, held);
  if (!number.startsWith(`${category}.`)) return { ok: false, reason: 'jd_category' };
  const unchanged = number === held || number === jdIdOfTitle(page.title);
  if (!unchanged && (await takenJdIds(db, category, page.id)).has(number)) {
    return { ok: false, reason: 'jd_taken' };
  }
  return { ok: true, frontmatter: { ...page.frontmatter, jd_id: number } };
}
