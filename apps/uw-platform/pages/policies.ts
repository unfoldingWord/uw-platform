import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { policyFrontmatterSchema, type PolicyEnforcement, type PolicyLevel } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { resolvePolicies, type PolicyCandidate, type PolicyChain } from '@uw/harness';
import { cascadeChainFrom, cascadeChainOf } from '../crosswalk/chain.ts';
import { summaryColumns, summarySchema, type PageSummary } from './reads.ts';

const POLICY_LIMIT = 200;
const DEEPEST = 20;
const APPLIES_TO = sql<string | null>`${pages.frontmatter} ->> 'applies_to'`;

export type ContextPolicy = {
  readonly page: PageSummary;
  readonly level: PolicyLevel;
  readonly enforcement: PolicyEnforcement;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
};

export type PolicyScope = {
  readonly itemId: string;
  readonly itemPageId: string | null;
};

export type Stored = { readonly page: PageSummary; readonly candidate: PolicyCandidate };

async function productOf(db: Executor, pageId: string | null): Promise<string | null> {
  if (pageId === null) return null;
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE chain(id, type, status, parent_id, depth) AS (
      SELECT id, type, status, parent_id, 1 FROM pages WHERE id = ${pageId}
      UNION ALL
      SELECT p.id, p.type, p.status, p.parent_id, c.depth + 1
      FROM pages p JOIN chain c ON p.id = c.parent_id WHERE c.depth < ${DEEPEST}
    )
    SELECT id FROM chain WHERE type = 'product' AND status <> 'retired' ORDER BY depth LIMIT 1`);
  return rows[0]?.id ?? null;
}

export async function policyChainFor(db: Executor, scope: PolicyScope): Promise<PolicyChain> {
  const product = await productOf(db, scope.itemPageId);
  const placed = [
    { kind: 'item', id: scope.itemId } as const,
    ...(product === null ? [] : [{ kind: 'page', id: product } as const]),
  ];
  const nodes = await cascadeChainOf(db, placed);
  return [
    ...(product === null ? [] : [{ level: 'product', pageId: product } as const]),
    ...nodes.map((node) => ({ level: node.tier, pageId: node.pageId })),
    { level: 'organization', pageId: null },
  ];
}

type Row = { readonly frontmatter: unknown; readonly id: string };

export function storedOf(row: Row): Stored | null {
  const { frontmatter, ...page } = row;
  const parsed = policyFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) return null;
  const facts = parsed.data;
  return {
    page: summarySchema.parse(page),
    candidate: {
      id: page.id,
      enforcement: facts.enforcement,
      appliesTo: facts.applies_to,
      supersedes: facts.supersedes,
      effectiveFrom: facts.effective_from,
      effectiveUntil: facts.effective_until,
    },
  };
}

export async function storedPolicies(
  db: Executor,
  chain: PolicyChain,
  onInvalid: (pageId: string) => void,
): Promise<readonly Stored[]> {
  const targets = chain.flatMap((link) => (link.pageId === null ? [] : [link.pageId]));
  const applies = or(
    isNull(APPLIES_TO),
    targets.length > 0 ? inArray(APPLIES_TO, targets) : undefined,
  );
  const rows = await db
    .select({ ...summaryColumns, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(eq(pages.type, 'policy'), eq(pages.status, 'active'), applies))
    .orderBy(asc(pages.id))
    .limit(POLICY_LIMIT);
  return rows.flatMap((row) => {
    const found = storedOf(row);
    if (found === null) onInvalid(row.id);
    return found === null ? [] : [found];
  });
}

export async function contextPolicies(
  db: Executor,
  actor: Principal,
  chain: PolicyChain,
  at: Date,
  onInvalid: (pageId: string) => void,
): Promise<readonly ContextPolicy[]> {
  const stored = await storedPolicies(db, chain, onInvalid);
  const pageOf = new Map(stored.map((found) => [found.page.id, found.page]));
  const resolution = resolvePolicies(
    chain,
    stored.map((found) => found.candidate),
    formatDate(at),
  );
  return resolution.inForce.flatMap((policy) => {
    const page = pageOf.get(policy.id);
    if (page === undefined || !can(actor, 'read', { kind: 'area', area: page.jdArea }, at)) {
      return [];
    }
    return [
      {
        page,
        level: policy.level,
        enforcement: policy.enforcement,
        effectiveFrom: policy.effectiveFrom,
        effectiveUntil: policy.effectiveUntil,
      },
    ];
  });
}

export async function chainOfTarget(db: Executor, target: string | null): Promise<PolicyChain> {
  const organization = { level: 'organization', pageId: null } as const;
  if (target === null) return [organization];
  const [row] = await db.select({ type: pages.type }).from(pages).where(eq(pages.id, target));
  if (row?.type === 'product') {
    const nodes = await cascadeChainOf(db, [{ kind: 'page', id: target }]);
    const placed = nodes.map((node) => ({ level: node.tier, pageId: node.pageId }));
    return [{ level: 'product', pageId: target }, ...placed, organization];
  }
  const nodes = await cascadeChainFrom(db, target);
  return [...nodes.map((node) => ({ level: node.tier, pageId: node.pageId })), organization];
}
