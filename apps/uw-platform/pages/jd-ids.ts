import { and, isNotNull, ne, or, sql } from 'drizzle-orm';
import {
  ASSISTANT_JD_CATEGORY,
  jdCategorySchema,
  jdIdOfTitle,
  knowledgeFrontmatterSchema,
  type JdCategory,
  type Page,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { assistantAccounts, pages } from '@uw/db/schema';

const filedIn = sql<string>`${pages.frontmatter}->>'jd_category'`;
const numbered = sql<string | null>`${pages.frontmatter}->>'jd_id'`;

type JdRefusal = 'jd_taken';

async function assistantJdIds(db: Executor, category: JdCategory): Promise<readonly string[]> {
  if (category !== ASSISTANT_JD_CATEGORY) return [];
  const rows = await db
    .select({ jdId: assistantAccounts.jdId })
    .from(assistantAccounts)
    .where(isNotNull(assistantAccounts.jdId));
  return rows.flatMap((row) => (row.jdId === null ? [] : [row.jdId]));
}

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
  const taken = new Set<string>(await assistantJdIds(db, category));
  for (const row of rows) {
    if (row.jdId !== null) taken.add(row.jdId);
    const titled = jdIdOfTitle(row.title);
    if (titled !== null) taken.add(titled);
  }
  return taken;
}

export type Renumbering =
  | {
      readonly ok: true;
      readonly jdId: string | null | undefined;
      readonly moveTo: JdCategory | null;
    }
  | { readonly ok: false; readonly reason: JdRefusal };

const unchanged: Renumbering = { ok: true, jdId: undefined, moveTo: null };

function unnumbered(page: Page, held: string | null): Renumbering {
  const inStep = held !== null && jdIdOfTitle(page.title) === held;
  return { ok: true, jdId: inStep ? null : held, moveTo: null };
}

export async function renumbered(db: Executor, page: Page, title: string): Promise<Renumbering> {
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  if (page.type !== 'knowledge' || !filed.success) return unchanged;
  const { jd_category: category, jd_id: held } = filed.data;
  const number = jdIdOfTitle(title);
  if (number === null) return unnumbered(page, held);
  const target = jdCategorySchema.parse(number.slice(0, 2));
  const moveTo = target === category ? null : target;
  const kept = moveTo === null && (number === held || number === jdIdOfTitle(page.title));
  if (!kept && (await takenJdIds(db, target, page.id)).has(number)) {
    return { ok: false, reason: 'jd_taken' };
  }
  return { ok: true, jdId: number, moveTo };
}

export function withJdId(
  frontmatter: Page['frontmatter'],
  jdId: string | null | undefined,
): Page['frontmatter'] {
  return jdId === undefined ? frontmatter : { ...frontmatter, jd_id: jdId };
}
