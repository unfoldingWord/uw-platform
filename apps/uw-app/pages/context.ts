import { and, asc, desc, eq, inArray, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  evidenceLabelSchema,
  learningFrontmatterSchema,
  type EvidenceLabel,
  type JdArea,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { areaFilter, summaryColumns, summarySchema, type PageSummary } from './reads.ts';

const LEARNING_LIMIT = 20;
const AREA_TIER = 3;
const notPackageTypes = ['learning', 'skill'];
const notPackageStatuses = ['retired'];

const learningFactsSchema = z.object({
  confidence: learningFrontmatterSchema.shape.confidence,
  as_of: learningFrontmatterSchema.shape.as_of,
});

type Learning = {
  readonly page: PageSummary;
  readonly confidence: EvidenceLabel;
  readonly asOf: string;
};

type ContextPages = {
  readonly instructions: PageSummary | null;
  readonly package: readonly PageSummary[];
  readonly learnings: readonly Learning[];
};

type ContextScope = {
  readonly itemPageId: string | null;
  readonly instructionsPageId: string | null;
  readonly area: JdArea;
};

type Readable = SQL | undefined;
type OnInvalid = (pageId: string) => void;

const nothing: ContextPages = { instructions: null, package: [], learnings: [] };

async function instructionsPage(
  db: Executor,
  pageId: string | null,
  readable: Readable,
): Promise<PageSummary | null> {
  if (pageId === null) return null;
  const [row] = await db
    .select(summaryColumns)
    .from(pages)
    .where(and(eq(pages.id, pageId), readable));
  return row ? summarySchema.parse(row) : null;
}

async function packagePages(
  db: Executor,
  pageId: string | null,
  readable: Readable,
): Promise<readonly PageSummary[]> {
  if (pageId === null) return [];
  const child = and(
    eq(pages.parentId, pageId),
    notInArray(pages.type, notPackageTypes),
    notInArray(pages.status, notPackageStatuses),
  );
  const rows = await db
    .select(summaryColumns)
    .from(pages)
    .where(and(or(eq(pages.id, pageId), child), readable))
    .orderBy(desc(sql`${pages.id} = ${pageId}`), asc(pages.id));
  return rows.map((row) => summarySchema.parse(row));
}

function parentTiers(scope: ContextScope): readonly (readonly [string, number])[] {
  const parents = [scope.itemPageId, scope.instructionsPageId];
  return parents.flatMap((id, n) => (id === null ? [] : [[id, n + 1] as const]));
}

function tierOf(tiers: readonly (readonly [string, number])[]): SQL {
  if (tiers.length === 0) return sql`${AREA_TIER}`;
  const whens = tiers.map(([id, tier]) => sql`WHEN ${pages.parentId} = ${id} THEN ${tier}::int`);
  return sql`CASE ${sql.join(whens, sql` `)} ELSE ${AREA_TIER}::int END`;
}

const CALENDAR_DATE = '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$';

function carriesFacts(): SQL | undefined {
  return and(
    inArray(sql`${pages.frontmatter} ->> 'confidence'`, [...evidenceLabelSchema.options]),
    sql`${pages.frontmatter} ->> 'as_of' ~ ${CALENDAR_DATE}`,
  );
}

function learningOf(row: { readonly frontmatter: unknown }): Learning | null {
  const { frontmatter, ...page } = row;
  const facts = learningFactsSchema.safeParse(frontmatter);
  if (!facts.success) return null;
  const { confidence, as_of: asOf } = facts.data;
  return { page: summarySchema.parse(page), confidence, asOf };
}

async function applicableLearnings(
  db: Executor,
  scope: ContextScope,
  readable: Readable,
  onInvalid: OnInvalid,
): Promise<readonly Learning[]> {
  const tiers = parentTiers(scope);
  const applies = or(eq(pages.jdArea, scope.area), ...tiers.map(([id]) => eq(pages.parentId, id)));
  const rows = await db
    .select({ ...summaryColumns, frontmatter: pages.frontmatter })
    .from(pages)
    .where(
      and(
        eq(pages.type, 'learning'),
        eq(pages.status, 'active'),
        applies,
        carriesFacts(),
        readable,
      ),
    )
    .orderBy(
      asc(tierOf(tiers)),
      sql`${pages.frontmatter} ->> 'as_of' DESC NULLS LAST`,
      asc(pages.id),
    )
    .limit(LEARNING_LIMIT);
  return rows.flatMap((row) => {
    const found = learningOf(row);
    if (found === null) onInvalid(row.id);
    return found === null ? [] : [found];
  });
}

export async function contextPages(
  db: Executor,
  actor: Principal,
  scope: ContextScope,
  at: Date,
  onInvalid: OnInvalid,
): Promise<ContextPages> {
  const readable = areaFilter(actor, at);
  if (readable === null) return nothing;
  return {
    instructions: await instructionsPage(db, scope.instructionsPageId, readable),
    package: await packagePages(db, scope.itemPageId, readable),
    learnings: await applicableLearnings(db, scope, readable, onInvalid),
  };
}
