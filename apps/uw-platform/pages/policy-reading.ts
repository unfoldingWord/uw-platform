import { and, asc, gt, inArray, ne, eq } from 'drizzle-orm';
import {
  policyFrontmatterSchema,
  policyLevelSchema,
  type Page,
  type PolicyEnforcement,
  type PolicyFrontmatter,
  type PolicyLevel,
} from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import type { PolicyCandidate, PolicyConflict } from '@uw/harness';
import { everyRow } from './batches.ts';
import { bookConflicts, openPolicyBook, type PolicyBook } from './policy-book.ts';
import { areaFilter, summaryColumns, summarySchema, type PageSummary } from './reads.ts';

export type ShownConflict = {
  readonly by: PageSummary;
  readonly over: PageSummary;
  readonly why: PolicyConflict['why'];
};

export type PolicyReading = {
  readonly level: PolicyLevel;
  readonly enforcement: PolicyEnforcement;
  readonly appliesTo: string | null;
  readonly target: PageSummary | null;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly copiedFrom: {
    readonly page: PageSummary | null;
    readonly version: number;
    readonly current: number | null;
    readonly adoptable: boolean;
  } | null;
  readonly conflicts: readonly ShownConflict[];
};

type Reader = { readonly actor: Principal; readonly at: Date };

type Known = PageSummary & {
  readonly version: number;
  readonly frontmatter: unknown;
};

async function knownPages(
  db: Executor,
  reader: Reader,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Known>> {
  const readable = areaFilter(reader.actor, reader.at);
  if (ids.length === 0 || readable === null) return new Map();
  const rows = await db
    .select({ ...summaryColumns, version: pages.version, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(inArray(pages.id, [...new Set(ids)]), readable));
  return new Map(rows.map((row) => [row.id, { ...row, ...summarySchema.parse(row) }]));
}

function candidateOf(id: string, facts: PolicyFrontmatter): PolicyCandidate {
  return {
    id,
    enforcement: facts.enforcement,
    appliesTo: facts.applies_to,
    supersedes: facts.supersedes,
    effectiveFrom: facts.effective_from,
    effectiveUntil: facts.effective_until,
  };
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

function levelOf(facts: PolicyFrontmatter, target: Known | undefined): PolicyLevel {
  if (facts.applies_to === null) return 'organization';
  const level = policyLevelSchema.safeParse(target?.type);
  return level.success ? level.data : 'organization';
}

function adoptable(source: Known | undefined, copied: number): boolean {
  if (source?.type !== 'policy' || source.status !== 'active') return false;
  const facts = policyFrontmatterSchema.safeParse(source.frontmatter);
  return facts.data?.enforcement === 'template' && source.version > copied;
}

function copiedFromOf(
  facts: PolicyFrontmatter,
  known: ReadonlyMap<string, Known>,
): PolicyReading['copiedFrom'] {
  const source = facts.copied_from;
  if (source === null) return null;
  const page = known.get(source.page_id);
  return {
    page: page ?? null,
    version: source.version,
    current: page?.version ?? null,
    adoptable: adoptable(page, source.version),
  };
}

type Facts = { readonly id: string; readonly facts: PolicyFrontmatter };

function idsOf({ id, facts }: Facts, conflicts: readonly PolicyConflict[]) {
  const named = [id, facts.applies_to, facts.copied_from?.page_id ?? null];
  const involved = conflicts.flatMap((conflict) => [conflict.id, conflict.supersedes]);
  return [...named, ...involved].filter((id): id is string => id !== null);
}

function readingOf(
  { facts }: Facts,
  conflicts: readonly PolicyConflict[],
  known: ReadonlyMap<string, Known>,
): PolicyReading {
  const target = facts.applies_to === null ? undefined : known.get(facts.applies_to);
  return {
    level: levelOf(facts, target),
    enforcement: facts.enforcement,
    appliesTo: facts.applies_to,
    target: target ?? null,
    effectiveFrom: facts.effective_from,
    effectiveUntil: facts.effective_until,
    copiedFrom: copiedFromOf(facts, known),
    conflicts: shownConflicts(conflicts, known),
  };
}

function factsOf(page: Page): Facts | null {
  const parsed = policyFrontmatterSchema.safeParse(page.frontmatter);
  return page.type === 'policy' && parsed.success ? { id: page.id, facts: parsed.data } : null;
}

const involves = (id: string) => (ids: readonly [string, string]) => ids.includes(id);

export async function policyReading(
  db: Executor,
  reader: Reader,
  page: Page,
): Promise<PolicyReading | null> {
  const found = factsOf(page);
  if (found === null) return null;
  const book = await openPolicyBook(db, [candidateOf(page.id, found.facts)]);
  const on = formatDate(reader.at);
  const conflicts = await bookConflicts(db, book, on, involves(page.id));
  const known = await knownPages(db, reader, idsOf(found, conflicts));
  return readingOf(found, conflicts, known);
}

export type ListedPolicy = { readonly page: PageSummary; readonly reading: PolicyReading };

async function readablePolicies(db: Executor, reader: Reader) {
  const readable = areaFilter(reader.actor, reader.at);
  if (readable === null) return [];
  return everyRow((after, size) =>
    db
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.type, 'policy'),
          ne(pages.status, 'retired'),
          readable,
          after === null ? undefined : gt(pages.id, after),
        ),
      )
      .orderBy(asc(pages.id))
      .limit(size),
  );
}

function conflictsFor(id: string, all: readonly PolicyConflict[]) {
  return all.filter((conflict) => conflict.id === id || conflict.supersedes === id);
}

export async function policyList(db: Executor, reader: Reader): Promise<readonly ListedPolicy[]> {
  const rows = await readablePolicies(db, reader);
  const listed = rows.flatMap((row) => {
    const parsed = policyFrontmatterSchema.safeParse(row.frontmatter);
    return parsed.success ? [{ row, facts: parsed.data }] : [];
  });
  const book: PolicyBook = await openPolicyBook(db);
  const all = await bookConflicts(db, book, formatDate(reader.at));
  const ids = listed.flatMap(({ row, facts }) =>
    idsOf({ id: row.id, facts }, conflictsFor(row.id, all)),
  );
  const known = await knownPages(db, reader, ids);
  return listed
    .map(({ row, facts }) => ({
      page: summarySchema.parse(row),
      reading: readingOf({ id: row.id, facts }, conflictsFor(row.id, all), known),
    }))
    .toSorted(
      (a, b) => a.page.title.localeCompare(b.page.title) || (a.page.id < b.page.id ? -1 : 1),
    );
}

export type PolicyTarget = { readonly id: string; readonly title: string; readonly type: string };

const TARGET_TYPES = ['portfolio', 'program', 'project', 'product'];

export async function policyTargets(
  db: Executor,
  reader: Reader,
): Promise<readonly PolicyTarget[]> {
  const readable = areaFilter(reader.actor, reader.at);
  if (readable === null) return [];
  const rows = await everyRow((after, size) =>
    db
      .select({ id: pages.id, title: pages.title, type: pages.type })
      .from(pages)
      .where(
        and(
          inArray(pages.type, TARGET_TYPES),
          ne(pages.status, 'retired'),
          readable,
          after === null ? undefined : gt(pages.id, after),
        ),
      )
      .orderBy(asc(pages.id))
      .limit(size),
  );
  return rows.toSorted((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
}
