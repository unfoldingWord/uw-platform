import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  suggestedChangeKindSchema,
  type ErrorReason,
  type Page,
  type ProposeReviewSetCommand,
  type SuggestedChangeInput,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { pageReviewSets, pageSuggestedChanges } from '@uw/db/schema';
import { anchorOf, resolveAnchor } from './anchors.ts';
import { overlapping } from './review-changes.ts';
import { lockedPage, readPage, type PageRefusal, type PageResult } from './store.ts';

export type ReviewSetRow = typeof pageReviewSets.$inferSelect;

export type StoredChange = SuggestedChangeInput & {
  readonly id: string;
  readonly author: string;
};

export type FoundReviewSet = {
  readonly set: ReviewSetRow;
  readonly changes: readonly StoredChange[];
  readonly page: Page;
};

export type PendingReviewSet = Pick<
  ReviewSetRow,
  'id' | 'name' | 'createdBy' | 'createdAt' | 'baseVersion'
>;

type Done = PageResult | PageRefusal;

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

type Anchored = { readonly changes: SuggestedChangeInput[] } | PageRefusal;

function anchoredIn(body: string, proposed: readonly SuggestedChangeInput[]): Anchored {
  const orphaned: string[] = [];
  const changes = proposed.map((change, index) => {
    const found = resolveAnchor(body, change.anchor);
    if (found.kind === 'orphaned') orphaned.push(String(index));
    const anchor =
      found.kind === 'anchored' ? anchorOf(body, found.start, found.end) : change.anchor;
    return { ...change, anchor };
  });
  if (orphaned.length > 0) return refused('anchor_orphaned', { changes: orphaned });
  const crossing = overlapping(changes).map(String);
  if (crossing.length > 0) return refused('changes_overlap', { changes: crossing });
  return { changes };
}

type Writing = {
  readonly reviewSetId: string;
  readonly author: string;
  readonly at: Date;
};

export async function writeChanges(
  tx: Transaction,
  writing: Writing,
  changes: readonly SuggestedChangeInput[],
): Promise<void> {
  if (changes.length === 0) return;
  await tx.insert(pageSuggestedChanges).values(
    changes.map((change, position) => ({
      id: crypto.randomUUID(),
      reviewSetId: writing.reviewSetId,
      position,
      kind: change.kind,
      startOffset: change.anchor.start,
      endOffset: change.anchor.end,
      exact: change.anchor.exact,
      prefix: change.anchor.prefix,
      suffix: change.anchor.suffix,
      proposedText: change.text,
      note: change.note,
      author: writing.author,
      createdAt: writing.at,
    })),
  );
}

async function replayOfRequest(tx: Transaction, actor: Principal, requestId: string) {
  const [held] = await tx
    .select({ id: pageReviewSets.id, createdBy: pageReviewSets.createdBy })
    .from(pageReviewSets)
    .where(eq(pageReviewSets.requestId, requestId));
  if (held === undefined) return null;
  return held.createdBy === actor.identity ? held.id : 'taken';
}

async function proposeIn(
  tx: Transaction,
  actor: Principal,
  command: ProposeReviewSetCommand,
  at: Date,
): Promise<Done> {
  const page = await lockedPage(tx, actor, command.pageId, at);
  if (page === null) return refused('page_not_found');
  if (!can(actor, 'write', { kind: 'area', area: page.jdArea }, at))
    return refused('not_permitted');
  const replay = await replayOfRequest(tx, actor, command.requestId);
  if (replay === 'taken') return refused('malformed_command', { fields: ['requestId'] });
  if (replay !== null) return { ok: true, page, reviewSetId: replay };
  if (page.version !== command.baseVersion) return refused('stale_version', { pageId: page.id });
  const anchored = anchoredIn(page.bodyMd, command.changes);
  if ('ok' in anchored) return anchored;
  const reviewSetId = crypto.randomUUID();
  await tx.insert(pageReviewSets).values({
    id: reviewSetId,
    pageId: page.id,
    name: command.name,
    baseVersion: page.version,
    status: 'pending',
    createdBy: actor.identity,
    createdAt: at,
    requestId: command.requestId,
  });
  await writeChanges(tx, { reviewSetId, author: actor.identity, at }, anchored.changes);
  return { ok: true, page, reviewSetId };
}

export function proposeReviewSet(
  db: Database,
  actor: Principal,
  command: ProposeReviewSetCommand,
  _traceId: string,
  at: Date,
): Promise<Done> {
  return db.transaction((tx) => proposeIn(tx, actor, command, at));
}

function storedChange(row: typeof pageSuggestedChanges.$inferSelect): StoredChange {
  return {
    id: row.id,
    author: row.author,
    kind: suggestedChangeKindSchema.parse(row.kind),
    anchor: {
      start: row.startOffset,
      end: row.endOffset,
      exact: row.exact,
      prefix: row.prefix,
      suffix: row.suffix,
    },
    text: row.proposedText,
    note: row.note,
  };
}

export async function changesOf(
  db: Executor,
  reviewSetIds: readonly string[],
): Promise<ReadonlyMap<string, StoredChange[]>> {
  const grouped = new Map<string, StoredChange[]>(reviewSetIds.map((id) => [id, []]));
  if (reviewSetIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(pageSuggestedChanges)
    .where(inArray(pageSuggestedChanges.reviewSetId, [...reviewSetIds]))
    .orderBy(asc(pageSuggestedChanges.reviewSetId), asc(pageSuggestedChanges.position));
  for (const row of rows) grouped.get(row.reviewSetId)?.push(storedChange(row));
  return grouped;
}

export async function reviewSetFor(
  db: Executor,
  actor: Principal,
  reviewSetId: string,
  at: Date,
): Promise<FoundReviewSet | null> {
  const [set] = await db.select().from(pageReviewSets).where(eq(pageReviewSets.id, reviewSetId));
  const page = set === undefined ? null : await readPage(db, actor, set.pageId, at);
  if (set === undefined || page === null) return null;
  const changes = (await changesOf(db, [set.id])).get(set.id) ?? [];
  return { set, changes, page };
}

export async function pendingReviewSets(
  db: Executor,
  actor: Principal,
  page: Page,
  at: Date,
): Promise<readonly PendingReviewSet[]> {
  if (!can(actor, 'read', { kind: 'area', area: page.jdArea }, at)) return [];
  return db
    .select({
      id: pageReviewSets.id,
      name: pageReviewSets.name,
      createdBy: pageReviewSets.createdBy,
      createdAt: pageReviewSets.createdAt,
      baseVersion: pageReviewSets.baseVersion,
    })
    .from(pageReviewSets)
    .where(and(eq(pageReviewSets.pageId, page.id), eq(pageReviewSets.status, 'pending')))
    .orderBy(asc(pageReviewSets.createdAt), asc(pageReviewSets.id));
}

export type Markable = {
  readonly changes: readonly SuggestedChangeInput[];
  readonly leftOut: number;
};

export async function markableChanges(
  db: Executor,
  actor: Principal,
  page: Page,
  at: Date,
): Promise<Markable> {
  const sets = await pendingReviewSets(db, actor, page, at);
  const current = sets.filter((set) => set.baseVersion === page.version).map((set) => set.id);
  const grouped = await changesOf(db, current);
  const all = current.flatMap((id) => grouped.get(id) ?? []);
  const kept: SuggestedChangeInput[] = [];
  for (const change of all) {
    const { kind, anchor, text, note } = change;
    const trial = [...kept, { kind, anchor, text, note }];
    if (overlapping(trial).length === 0) kept.push({ kind, anchor, text, note });
  }
  return { changes: kept, leftOut: all.length - kept.length };
}
