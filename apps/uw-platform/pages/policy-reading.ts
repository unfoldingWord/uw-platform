import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  policyFrontmatterSchema,
  type Page,
  type PolicyEnforcement,
  type PolicyFrontmatter,
  type PolicyLevel,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { resolvePolicies, type PolicyConflict } from '@uw/harness';
import { chainOfTarget, storedOf, storedPolicies, type Stored } from './policies.ts';
import { toPage } from './store.ts';
import { summaryColumns, summarySchema, type PageSummary } from './reads.ts';

const SUPERSEDERS_LIMIT = 20;
const LIST_LIMIT = 200;

export type ShownConflict = {
  readonly by: PageSummary;
  readonly over: PageSummary;
  readonly why: PolicyConflict['why'];
};

export type PolicyReading = {
  readonly level: PolicyLevel;
  readonly enforcement: PolicyEnforcement;
  readonly target: PageSummary | null;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly copiedFrom: {
    readonly page: PageSummary | null;
    readonly version: number;
    readonly current: number | null;
  } | null;
  readonly conflicts: readonly ShownConflict[];
};

type Reader = { readonly actor: Principal; readonly at: Date };

const readable = (reader: Reader, area: string) =>
  can(reader.actor, 'read', { kind: 'area', area }, reader.at);

async function summaries(
  db: Executor,
  reader: Reader,
  ids: readonly string[],
): Promise<ReadonlyMap<string, PageSummary & { readonly version: number }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ ...summaryColumns, version: pages.version })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
  return new Map(
    rows
      .filter((row) => readable(reader, row.jdArea))
      .map((row) => [row.id, { ...summarySchema.parse(row), version: row.version }]),
  );
}

async function supersedersOf(db: Executor, pageId: string): Promise<readonly Stored[]> {
  const naming = sql`${pages.frontmatter} -> 'supersedes' ? ${pageId}`;
  const rows = await db
    .select({ ...summaryColumns, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(eq(pages.type, 'policy'), eq(pages.status, 'active'), naming))
    .orderBy(asc(pages.id))
    .limit(SUPERSEDERS_LIMIT);
  return rows.flatMap((row) => storedOf(row) ?? []);
}

async function conflictsOf(
  db: Executor,
  page: Page,
  facts: PolicyFrontmatter,
  on: string,
): Promise<readonly PolicyConflict[]> {
  const self = {
    id: page.id,
    enforcement: facts.enforcement,
    appliesTo: facts.applies_to,
    supersedes: facts.supersedes,
    effectiveFrom: facts.effective_from,
    effectiveUntil: facts.effective_until,
  };
  const replacing = [self, ...(await supersedersOf(db, page.id)).map((found) => found.candidate)];
  const found: PolicyConflict[] = [];
  for (const policy of replacing) {
    const chain = await chainOfTarget(db, policy.appliesTo);
    const onChain = (await storedPolicies(db, chain, () => undefined)).map((s) => s.candidate);
    const candidates = [policy, ...onChain.filter((other) => other.id !== policy.id)];
    const { conflicts } = resolvePolicies(chain, candidates, on);
    found.push(
      ...conflicts.filter(
        (conflict) =>
          conflict.id === policy.id && (conflict.id === page.id || conflict.supersedes === page.id),
      ),
    );
  }
  return found;
}

function shownConflicts(
  conflicts: readonly PolicyConflict[],
  known: ReadonlyMap<string, PageSummary>,
): readonly ShownConflict[] {
  return conflicts.flatMap((conflict) => {
    const by = known.get(conflict.id);
    const over = known.get(conflict.supersedes);
    return by === undefined || over === undefined ? [] : [{ by, over, why: conflict.why }];
  });
}

type Known = ReadonlyMap<string, PageSummary & { readonly version: number }>;

function idsOf(page: Page, facts: PolicyFrontmatter, conflicts: readonly PolicyConflict[]) {
  const named = [page.id, facts.applies_to, facts.copied_from?.page_id ?? null];
  const involved = conflicts.flatMap((conflict) => [conflict.id, conflict.supersedes]);
  return [...new Set([...named, ...involved].filter((id): id is string => id !== null))];
}

function copiedFromOf(facts: PolicyFrontmatter, known: Known): PolicyReading['copiedFrom'] {
  const source = facts.copied_from;
  if (source === null) return null;
  const page = known.get(source.page_id) ?? null;
  return { page, version: source.version, current: page?.version ?? null };
}

function targetOf(facts: PolicyFrontmatter, known: Known): PageSummary | null {
  return facts.applies_to === null ? null : (known.get(facts.applies_to) ?? null);
}

export async function policyReading(
  db: Executor,
  reader: Reader,
  page: Page,
): Promise<PolicyReading | null> {
  const parsed = policyFrontmatterSchema.safeParse(page.frontmatter);
  if (page.type !== 'policy' || !parsed.success) return null;
  const facts = parsed.data;
  const chain = await chainOfTarget(db, facts.applies_to);
  const conflicts = await conflictsOf(db, page, facts, formatDate(reader.at));
  const known = await summaries(db, reader, idsOf(page, facts, conflicts));
  return {
    level: chain.at(0)?.level ?? 'organization',
    enforcement: facts.enforcement,
    target: targetOf(facts, known),
    effectiveFrom: facts.effective_from,
    effectiveUntil: facts.effective_until,
    copiedFrom: copiedFromOf(facts, known),
    conflicts: shownConflicts(conflicts, known),
  };
}

export type ListedPolicy = { readonly page: PageSummary; readonly reading: PolicyReading };

export async function policyList(db: Executor, reader: Reader): Promise<readonly ListedPolicy[]> {
  const rows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.type, 'policy'), ne(pages.status, 'retired')))
    .orderBy(asc(pages.title), asc(pages.id))
    .limit(LIST_LIMIT);
  const listed: ListedPolicy[] = [];
  for (const row of rows) {
    if (!readable(reader, row.jdArea)) continue;
    const page = toPage(row);
    const reading = await policyReading(db, reader, page);
    if (reading !== null) listed.push({ page: summarySchema.parse(row), reading });
  }
  return listed;
}

export type PolicyTarget = { readonly id: string; readonly title: string; readonly type: string };

const TARGET_TYPES = ['portfolio', 'program', 'project', 'product'];

export async function policyTargets(
  db: Executor,
  reader: Reader,
): Promise<readonly PolicyTarget[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, type: pages.type, jdArea: pages.jdArea })
    .from(pages)
    .where(and(inArray(pages.type, TARGET_TYPES), ne(pages.status, 'retired')))
    .orderBy(asc(pages.type), asc(pages.title))
    .limit(LIST_LIMIT);
  return rows
    .filter((row) => readable(reader, row.jdArea))
    .map(({ id, title, type }) => ({ id, title, type }));
}
