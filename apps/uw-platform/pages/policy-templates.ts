import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import {
  policyFrontmatterSchema,
  type AdoptTemplateUpdateCommand,
  type CopyTemplatePolicyCommand,
  type Page,
  type PolicyFrontmatter,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { templateDrift, type TemplateDrift } from '@uw/harness';
import { slugFor } from './copy.ts';
import { summarySchema, type PageSummary } from './reads.ts';
import { createPage, readPage, updatePage, type PageRefusal, type PageResult } from './store.ts';

const DRIFT_LIMIT = 500;

type Done = PageResult | PageRefusal;

export type DriftEntry = TemplateDrift & {
  readonly copy: PageSummary;
  readonly source: PageSummary | null;
};

function refused(reason: PageRefusal['reason'], why?: string): PageRefusal {
  return { ok: false, reason, detail: why === undefined ? {} : { why } };
}

function policyOf(page: Page | null): PolicyFrontmatter | null {
  if (page?.type !== 'policy') return null;
  const parsed = policyFrontmatterSchema.safeParse(page.frontmatter);
  return parsed.success ? parsed.data : null;
}

export async function copyTemplatePolicy(
  db: Database,
  actor: Principal,
  command: CopyTemplatePolicyCommand,
  traceId: string,
  at: Date,
): Promise<Done> {
  const template = await readPage(db, actor, command.templateId, at);
  const facts = policyOf(template);
  if (template === null) return refused('page_not_found');
  if (facts?.enforcement !== 'template' || template.status !== 'active') {
    return refused('malformed_command', 'not_a_template');
  }
  const frontmatter: PolicyFrontmatter = {
    enforcement: command.enforcement,
    applies_to: command.appliesTo,
    supersedes: [],
    effective_from: command.effectiveFrom,
    effective_until: null,
    copied_from: { page_id: template.id, version: template.version },
  };
  const create = {
    command: 'create_page' as const,
    requestId: command.requestId,
    pageId: command.pageId,
    type: 'policy',
    jdArea: command.jdArea,
    slug: slugFor(command.title, command.pageId),
    title: command.title,
    parentId: null,
    frontmatter,
    bodyMd: template.bodyMd,
    status: 'suggested' as const,
  };
  return createPage(db, actor, create, traceId, at);
}

export async function adoptTemplateUpdate(
  db: Database,
  actor: Principal,
  command: AdoptTemplateUpdateCommand,
  traceId: string,
  at: Date,
): Promise<Done> {
  const copy = await readPage(db, actor, command.pageId, at);
  const facts = policyOf(copy);
  if (copy === null) return refused('page_not_found');
  if (facts?.copied_from == null) return refused('malformed_command', 'not_a_copy');
  const source = await readPage(db, actor, facts.copied_from.page_id, at);
  if (source === null || source.status === 'retired') return refused('page_not_found');
  if (source.version <= facts.copied_from.version)
    return refused('malformed_command', 'not_behind');
  const copiedFrom = { page_id: source.id, version: source.version };
  return updatePage(
    db,
    actor,
    {
      command: 'update_page',
      requestId: command.requestId,
      pageId: copy.id,
      expectedVersion: command.expectedVersion,
      slug: copy.slug,
      title: copy.title,
      parentId: copy.parentId,
      frontmatter: { ...facts, copied_from: copiedFrom },
      bodyMd: source.bodyMd,
      status: copy.status,
    },
    traceId,
    at,
  );
}

const COPIED_FROM = sql<string | null>`${pages.frontmatter} -> 'copied_from' ->> 'page_id'`;

async function copyRows(db: Executor) {
  return db
    .select({
      id: pages.id,
      type: pages.type,
      jdArea: pages.jdArea,
      slug: pages.slug,
      title: pages.title,
      status: pages.status,
      frontmatter: pages.frontmatter,
    })
    .from(pages)
    .where(and(eq(pages.type, 'policy'), ne(pages.status, 'retired'), isNotNull(COPIED_FROM)))
    .limit(DRIFT_LIMIT);
}

async function sourceRows(db: Executor, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: pages.id,
      type: pages.type,
      jdArea: pages.jdArea,
      slug: pages.slug,
      title: pages.title,
      status: pages.status,
      version: pages.version,
    })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
}

export async function templateDriftFor(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly DriftEntry[]> {
  const readable = (area: string) => can(actor, 'read', { kind: 'area', area }, at);
  const copies = (await copyRows(db)).flatMap((row) => {
    const source = policyFrontmatterSchema.safeParse(row.frontmatter).data?.copied_from;
    if (source == null || !readable(row.jdArea)) return [];
    return [
      { row, copy: { id: row.id, source: { pageId: source.page_id, version: source.version } } },
    ];
  });
  const sources = await sourceRows(db, [...new Set(copies.map((c) => c.copy.source.pageId))]);
  const seen = sources.filter((source) => readable(source.jdArea));
  const drift = templateDrift(
    copies.map((c) => c.copy),
    seen,
  );
  const copyPage = new Map(copies.map((c) => [c.row.id, summarySchema.parse(c.row)]));
  const sourcePage = new Map(seen.map((source) => [source.id, summarySchema.parse(source)]));
  return drift.flatMap((entry) => {
    const copy = copyPage.get(entry.copyId);
    return copy === undefined
      ? []
      : [{ ...entry, copy, source: sourcePage.get(entry.sourceId) ?? null }];
  });
}
