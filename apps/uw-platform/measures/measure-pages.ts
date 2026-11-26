import { and, eq, inArray, like, or } from 'drizzle-orm';
import {
  dashboardFrontmatterSchema,
  measureFrontmatterSchema,
  pageStatusSchema,
  type DashboardContext,
  type MeasureFrontmatter,
  type PageStatus,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { panelBlocks } from './panel-blocks.ts';

type Stored = {
  readonly id: string;
  readonly jdArea: string;
  readonly title: string;
  readonly version: number;
  readonly status: PageStatus;
  readonly bodyMd: string;
};

export type MeasurePage = Stored & { readonly measure: MeasureFrontmatter };
export type DashboardPage = Stored & { readonly context: DashboardContext };

const columns = {
  id: pages.id,
  jdArea: pages.jdArea,
  title: pages.title,
  version: pages.version,
  status: pages.status,
  bodyMd: pages.bodyMd,
  frontmatter: pages.frontmatter,
};

async function storedOf(db: Executor, pageId: string, type: string) {
  const [row] = await db
    .select(columns)
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.type, type)));
  if (row === undefined) return null;
  const { frontmatter, ...rest } = row;
  return { stored: { ...rest, status: pageStatusSchema.parse(rest.status) }, frontmatter };
}

export async function measurePageOf(db: Executor, measureId: string): Promise<MeasurePage | null> {
  const found = await storedOf(db, measureId, 'measure');
  if (found === null) return null;
  const measure = measureFrontmatterSchema.safeParse(found.frontmatter);
  return measure.success ? { ...found.stored, measure: measure.data } : null;
}

export async function dashboardPageOf(
  db: Executor,
  dashboardId: string,
): Promise<DashboardPage | null> {
  const found = await storedOf(db, dashboardId, 'dashboard');
  if (found === null) return null;
  const parsed = dashboardFrontmatterSchema.safeParse(found.frontmatter);
  return parsed.success ? { ...found.stored, context: parsed.data.context } : null;
}

export async function readableMeasure(
  db: Executor,
  actor: Principal,
  measureId: string,
  at: Date,
): Promise<MeasurePage | null> {
  const found = await measurePageOf(db, measureId);
  if (found === null) return null;
  return can(actor, 'read', { kind: 'area', area: found.jdArea }, at) ? found : null;
}

export async function readablePagesOfType(
  db: Executor,
  actor: Principal,
  request: { readonly ids: readonly string[]; readonly types: readonly string[] | null },
  at: Date,
): Promise<ReadonlySet<string>> {
  if (request.ids.length === 0) return new Set();
  const typed = request.types === null ? undefined : inArray(pages.type, [...request.types]);
  const rows = await db
    .select({ id: pages.id, jdArea: pages.jdArea })
    .from(pages)
    .where(and(inArray(pages.id, [...request.ids]), typed));
  const readable = rows.filter((row) => can(actor, 'read', { kind: 'area', area: row.jdArea }, at));
  return new Set(readable.map((row) => row.id));
}

export async function measureArea(db: Executor, measureId: string): Promise<string | null> {
  const [row] = await db
    .select({ jdArea: pages.jdArea })
    .from(pages)
    .where(and(eq(pages.id, measureId), eq(pages.type, 'measure')));
  return row?.jdArea ?? null;
}

export type OfferedDashboard = { readonly id: string; readonly title: string };

const MOST_OFFERED = 20;

function namesMeasure(bodyMd: string, measureId: string): boolean {
  return panelBlocks(bodyMd).some((block) => 'panel' in block && block.panel.measure === measureId);
}

export async function offeredDashboards(
  db: Executor,
  actor: Principal,
  measure: MeasurePage,
  at: Date,
): Promise<readonly OfferedDashboard[]> {
  const card = measure.measure.report_card;
  const naming = like(pages.bodyMd, `%${measure.id}%`);
  const rows = await db
    .select({ id: pages.id, title: pages.title, jdArea: pages.jdArea, bodyMd: pages.bodyMd })
    .from(pages)
    .where(
      and(
        eq(pages.type, 'dashboard'),
        eq(pages.status, 'suggested'),
        card === null ? naming : or(naming, eq(pages.id, card)),
      ),
    )
    .orderBy(pages.title)
    .limit(MOST_OFFERED);
  return rows
    .filter((row) => row.id === card || namesMeasure(row.bodyMd, measure.id))
    .filter((row) => can(actor, 'write', { kind: 'area', area: row.jdArea }, at))
    .map((row) => ({ id: row.id, title: row.title }));
}
