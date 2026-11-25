import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { decisionFrontmatterSchema, type PolicyLevel } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import type { PolicyChain } from '@uw/harness';
import { summaryColumns, summarySchema, type PageSummary } from './reads.ts';

const DECISION_LIMIT = 20;
const CANDIDATE_LIMIT = 200;
const APPLIES_TO = sql<string | null>`${pages.frontmatter} ->> 'applies_to'`;

export type ContextDecision = {
  readonly page: PageSummary;
  readonly level: PolicyLevel;
  readonly decidedOn: string;
};

type Found = ContextDecision & { readonly depth: number; readonly supersedes: readonly string[] };

type Row = { readonly frontmatter: unknown; readonly id: string };

function foundOf(chain: PolicyChain, row: Row): Found | null {
  const { frontmatter, ...page } = row;
  const parsed = decisionFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) return null;
  const depth = chain.findIndex((link) => link.pageId === parsed.data.applies_to);
  const link = depth === -1 ? undefined : chain.at(depth);
  if (link === undefined) return null;
  return {
    page: summarySchema.parse(page),
    level: link.level,
    decidedOn: parsed.data.decided_on,
    depth,
    supersedes: parsed.data.supersedes,
  };
}

function byPrecedence(a: Found, b: Found): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.decidedOn !== b.decidedOn) return a.decidedOn > b.decidedOn ? -1 : 1;
  return a.page.id < b.page.id ? -1 : a.page.id > b.page.id ? 1 : 0;
}

async function storedDecisions(db: Executor, chain: PolicyChain): Promise<readonly Row[]> {
  const targets = chain.flatMap((link) => (link.pageId === null ? [] : [link.pageId]));
  const onChain = targets.length > 0 ? inArray(APPLIES_TO, targets) : undefined;
  return db
    .select({ ...summaryColumns, frontmatter: pages.frontmatter })
    .from(pages)
    .where(
      and(eq(pages.type, 'decision'), eq(pages.status, 'active'), or(isNull(APPLIES_TO), onChain)),
    )
    .orderBy(asc(pages.id))
    .limit(CANDIDATE_LIMIT);
}

export async function contextDecisions(
  db: Executor,
  actor: Principal,
  chain: PolicyChain,
  at: Date,
  onInvalid: (pageId: string) => void,
): Promise<readonly ContextDecision[]> {
  const rows = await storedDecisions(db, chain);
  const found = rows.flatMap((row) => {
    const decision = foundOf(chain, row);
    if (decision === null) onInvalid(row.id);
    return decision === null ? [] : [decision];
  });
  const replaced = new Set(found.flatMap((decision) => decision.supersedes));
  return found
    .filter((decision) => !replaced.has(decision.page.id))
    .filter((decision) => can(actor, 'read', { kind: 'area', area: decision.page.jdArea }, at))
    .toSorted(byPrecedence)
    .slice(0, DECISION_LIMIT)
    .map(({ page, level, decidedOn }) => ({ page, level, decidedOn }));
}
