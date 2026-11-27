import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { ExpressionFields, ExpressionStatus } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages, storyExpressions } from '@uw/db/schema';

export type ExpressionRow = typeof storyExpressions.$inferSelect;

type Stored = Omit<ExpressionFields, 'url'> & { readonly url: string };

type Adding = {
  readonly pageId: string;
  readonly fields: Stored;
  readonly status: ExpressionStatus;
  readonly by: string;
  readonly at: Date;
};

function columnsOf(fields: Stored) {
  return {
    title: fields.title,
    format: fields.format,
    venue: fields.venue,
    channel: fields.channel,
    url: fields.url,
    language: fields.language,
    publishedOn: fields.publishedOn,
    excerpt: fields.excerpt,
  };
}

export async function expressionRowsOf(
  db: Executor,
  pageIds: readonly string[],
): Promise<readonly ExpressionRow[]> {
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return [];
  return db
    .select()
    .from(storyExpressions)
    .where(inArray(storyExpressions.pageId, ids))
    .orderBy(asc(storyExpressions.addedAt), asc(storyExpressions.id));
}

export async function expressionRowOf(db: Executor, id: string): Promise<ExpressionRow | null> {
  const [row] = await db
    .select()
    .from(storyExpressions)
    .where(eq(storyExpressions.id, id))
    .for('update');
  return row ?? null;
}

export async function expressionAt(
  db: Executor,
  pageId: string,
  url: string,
): Promise<ExpressionRow | null> {
  const [row] = await db
    .select()
    .from(storyExpressions)
    .where(and(eq(storyExpressions.pageId, pageId), eq(storyExpressions.url, url)));
  return row ?? null;
}

export async function urlTakenElsewhere(
  db: Executor,
  row: ExpressionRow,
  url: string,
): Promise<boolean> {
  const [other] = await db
    .select({ id: storyExpressions.id })
    .from(storyExpressions)
    .where(
      and(
        eq(storyExpressions.pageId, row.pageId),
        eq(storyExpressions.url, url),
        ne(storyExpressions.id, row.id),
      ),
    );
  return other !== undefined;
}

export async function insertExpression(
  db: Executor,
  adding: Adding,
): Promise<ExpressionRow | null> {
  const decided = adding.status === 'suggested' ? null : adding.by;
  const [row] = await db
    .insert(storyExpressions)
    .values({
      pageId: adding.pageId,
      ...columnsOf(adding.fields),
      kind: 'link',
      status: adding.status,
      addedBy: adding.by,
      addedAt: adding.at,
      decidedBy: decided,
      decidedAt: decided === null ? null : adding.at,
    })
    .onConflictDoNothing({ target: [storyExpressions.pageId, storyExpressions.url] })
    .returning();
  return row ?? null;
}

export async function keepExpressionFields(
  db: Executor,
  id: string,
  fields: Stored,
): Promise<ExpressionRow | null> {
  const [row] = await db
    .update(storyExpressions)
    .set(columnsOf(fields))
    .where(eq(storyExpressions.id, id))
    .returning();
  return row ?? null;
}

export async function decideExpression(
  db: Executor,
  id: string,
  status: ExpressionStatus,
  decided: { readonly by: string; readonly at: Date },
): Promise<void> {
  await db
    .update(storyExpressions)
    .set({ status, decidedBy: decided.by, decidedAt: decided.at })
    .where(eq(storyExpressions.id, id));
}

export async function expressionArea(db: Executor, id: string): Promise<string | null> {
  const [row] = await db
    .select({ jdArea: pages.jdArea })
    .from(storyExpressions)
    .innerJoin(pages, eq(pages.id, storyExpressions.pageId))
    .where(eq(storyExpressions.id, id));
  return row?.jdArea ?? null;
}
