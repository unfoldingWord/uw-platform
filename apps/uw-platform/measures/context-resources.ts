import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { MetricContext } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageLinks, pages } from '@uw/db/schema';
import { areaFilter } from '../pages/reads.ts';

export type ContextResource = {
  readonly resourceId: string;
  readonly title: string;
  readonly area: string;
};

const SERVES = ['resource.serves_portfolio', 'resource.serves_program', 'resource.serves_project'];
const CHILDREN = ['program.portfolio', 'project.program'];
const MOST_RESOURCES = 500;
const DEPTH = 2;

type Reader = { readonly db: Executor; readonly actor: Principal; readonly at: Date };

async function childrenOf(db: Executor, parents: readonly string[]): Promise<string[]> {
  if (parents.length === 0) return [];
  const rows = await db
    .selectDistinct({ id: pageLinks.fromPage })
    .from(pageLinks)
    .where(and(inArray(pageLinks.rel, CHILDREN), inArray(pageLinks.toPage, [...parents])));
  return rows.map((row) => row.id);
}

async function pageAndDescendants(
  db: Executor,
  pageId: string,
  descendants: boolean,
): Promise<readonly string[]> {
  const found = new Set([pageId]);
  let frontier = [pageId];
  for (let level = 0; descendants && level < DEPTH && frontier.length > 0; level += 1) {
    frontier = (await childrenOf(db, frontier)).filter((id) => !found.has(id));
    for (const id of frontier) found.add(id);
  }
  return [...found];
}

async function pageReadable(reader: Reader, pageId: string): Promise<boolean> {
  const [row] = await reader.db
    .select({ jdArea: pages.jdArea })
    .from(pages)
    .where(eq(pages.id, pageId));
  return (
    row !== undefined && can(reader.actor, 'read', { kind: 'area', area: row.jdArea }, reader.at)
  );
}

async function servingCondition(reader: Reader, context: MetricContext): Promise<SQL | null> {
  if (context.kind === 'organization') {
    return sql`${pages.frontmatter}->>'kind' = ${context.resource_kind}`;
  }
  if (context.kind === 'resources') return inArray(pages.id, [...context.resource_ids]);
  if (!(await pageReadable(reader, context.page_id))) return null;
  const targets = await pageAndDescendants(reader.db, context.page_id, context.descendants);
  const serving = reader.db
    .select({ id: pageLinks.fromPage })
    .from(pageLinks)
    .where(and(inArray(pageLinks.rel, SERVES), inArray(pageLinks.toPage, [...targets])));
  return inArray(pages.id, serving);
}

export async function resourcesInContext(
  db: Executor,
  actor: Principal,
  context: MetricContext,
  at: Date,
): Promise<readonly ContextResource[]> {
  const areas = areaFilter(actor, at);
  const condition = areas === null ? null : await servingCondition({ db, actor, at }, context);
  if (areas === null || condition === null) return [];
  return db
    .select({ resourceId: pages.id, title: pages.title, area: pages.jdArea })
    .from(pages)
    .where(and(eq(pages.type, 'resource'), ne(pages.status, 'retired'), areas, condition))
    .orderBy(asc(pages.title), asc(pages.id))
    .limit(MOST_RESOURCES);
}
