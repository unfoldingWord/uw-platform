import { eq } from 'drizzle-orm';
import {
  frontmatterSchema,
  type AcceptReviewSetCommand,
  type ErrorReason,
  type Page,
  type RejectReviewSetCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { pageReviewDecisions, pageReviewSets } from '@uw/db/schema';
import { pageVersion } from './history.ts';
import { applyChanges } from './review-changes.ts';
import { changesOf, type ReviewSetRow } from './review-sets.ts';
import { lockedPage, updateWithin, type PageRefusal, type PageResult } from './store.ts';

type Done = PageResult | PageRefusal;

type Request = { readonly traceId: string; readonly at: Date; readonly requestId: string };

type Found = { readonly set: ReviewSetRow; readonly page: Page };

type Decision = Pick<AcceptReviewSetCommand, 'reviewSetId' | 'revision' | 'requestId'>;

type Locked = Found | { readonly replay: Found } | PageRefusal;

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

async function setRow(tx: Transaction, reviewSetId: string, lock: boolean) {
  const query = tx.select().from(pageReviewSets).where(eq(pageReviewSets.id, reviewSetId));
  const [set] = lock ? await query.for('update') : await query;
  return set;
}

function decidedAlready(actor: Principal, decision: Decision, found: Found): Locked {
  const { set } = found;
  const same = set.decisionRequestId === decision.requestId && set.decidedBy === actor.identity;
  return same ? { replay: found } : refused('suggestion_decided', { status: set.status });
}

async function lockedSet(
  tx: Transaction,
  actor: Principal,
  decision: Decision,
  at: Date,
): Promise<Locked> {
  const seen = await setRow(tx, decision.reviewSetId, false);
  const page = seen === undefined ? null : await lockedPage(tx, actor, seen.pageId, at);
  const set = page === null ? undefined : await setRow(tx, decision.reviewSetId, true);
  if (set === undefined || page === null || set.pageId !== page.id) {
    return refused('suggestion_not_found');
  }
  if (!can(actor, 'write', { kind: 'area', area: page.jdArea }, at)) {
    return refused('not_permitted');
  }
  if (set.status !== 'pending') return decidedAlready(actor, decision, { set, page });
  if (set.revision !== decision.revision) {
    return refused('suggestion_changed', { revision: String(set.revision) });
  }
  return { set, page };
}

async function recorded(
  tx: Transaction,
  actor: Principal,
  found: Found,
  outcome: { readonly request: Request; readonly acceptedVersion: number | null },
): Promise<void> {
  const { request, acceptedVersion } = outcome;
  const decision = acceptedVersion === null ? 'rejected' : 'accepted';
  const decided = {
    decidedBy: actor.identity,
    decidedAt: request.at,
    decisionRequestId: request.requestId,
  };
  await tx
    .update(pageReviewSets)
    .set({ status: decision, acceptedVersion, ...decided })
    .where(eq(pageReviewSets.id, found.set.id));
  await tx.insert(pageReviewDecisions).values({
    id: crypto.randomUUID(),
    reviewSetId: found.set.id,
    pageId: found.page.id,
    decision,
    decidedBy: actor.identity,
    decidedAt: request.at,
    requestId: request.requestId,
    traceId: request.traceId,
    acceptedVersion,
  });
}

async function acceptIn(
  tx: Transaction,
  actor: Principal,
  found: Found,
  request: Request,
): Promise<Done> {
  const { set, page } = found;
  const frontmatter = frontmatterSchema.safeParse(set.frontmatter ?? page.frontmatter);
  if (!frontmatter.success) return refused('invalid_frontmatter');
  const changes = (await changesOf(tx, [set.id])).get(set.id) ?? [];
  const command = {
    command: 'update_page' as const,
    requestId: request.requestId,
    pageId: page.id,
    expectedVersion: set.baseVersion,
    slug: page.slug,
    title: set.title ?? page.title,
    parentId: page.parentId,
    frontmatter: frontmatter.data,
    bodyMd: applyChanges(page.bodyMd, changes),
  };
  const checked = { command, statusFor: (stored: Page) => stored.status };
  const saved = await updateWithin(tx, actor, checked, request);
  if (!saved.ok) return saved;
  await recorded(tx, actor, found, { request, acceptedVersion: saved.page.version });
  return saved;
}

async function replayed(tx: Transaction, actor: Principal, found: Found, at: Date): Promise<Done> {
  const version = found.set.acceptedVersion;
  if (version === null) return { ok: true, page: found.page };
  const kept = await pageVersion(tx, actor, { pageId: found.page.id, version }, at);
  return { ok: true, page: kept?.page ?? found.page };
}

export async function acceptReviewSet(
  db: Database,
  actor: Principal,
  command: AcceptReviewSetCommand,
  traceId: string,
  at: Date,
): Promise<Done> {
  if (actor.kind !== 'person') return refused('not_permitted');
  return db.transaction(async (tx) => {
    const found = await lockedSet(tx, actor, command, at);
    if ('ok' in found) return found;
    if ('replay' in found) return replayed(tx, actor, found.replay, at);
    if (found.page.version !== found.set.baseVersion) {
      return refused('stale_version', { pageId: found.page.id });
    }
    return acceptIn(tx, actor, found, { traceId, at, requestId: command.requestId });
  });
}

export async function rejectReviewSet(
  db: Database,
  actor: Principal,
  command: RejectReviewSetCommand,
  traceId: string,
  at: Date,
): Promise<Done> {
  if (actor.kind !== 'person') return refused('not_permitted');
  return db.transaction(async (tx) => {
    const found = await lockedSet(tx, actor, command, at);
    if ('ok' in found) return found;
    if ('replay' in found) return { ok: true, page: found.replay.page };
    const request = { traceId, at, requestId: command.requestId };
    await recorded(tx, actor, found, { request, acceptedVersion: null });
    return { ok: true, page: found.page };
  });
}
