import { eq } from 'drizzle-orm';
import {
  frontmatterSchema,
  type AcceptSuggestionCommand,
  type ErrorReason,
  type Page,
  type RejectSuggestionCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { pageSuggestionSets } from '@uw/db/schema';
import { pageVersion } from './history.ts';
import { lockedPage, updateWithin, type PageRefusal, type PageResult } from './store.ts';

type SetRow = typeof pageSuggestionSets.$inferSelect;

type Done = PageResult | PageRefusal;

type Request = { readonly traceId: string; readonly at: Date };

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

type Found = { readonly set: SetRow; readonly page: Page };

type Decision = Pick<AcceptSuggestionCommand, 'suggestionId' | 'revision' | 'requestId'>;

type Locked = Found | { readonly replay: Found } | PageRefusal;

async function setRow(tx: Transaction, suggestionId: string, lock: boolean) {
  const query = tx.select().from(pageSuggestionSets).where(eq(pageSuggestionSets.id, suggestionId));
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
  const seen = await setRow(tx, decision.suggestionId, false);
  const page = seen === undefined ? null : await lockedPage(tx, actor, seen.pageId, at);
  const set = page === null ? undefined : await setRow(tx, decision.suggestionId, true);
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

function decided(actor: Principal, at: Date, requestId: string) {
  return { decidedBy: actor.identity, decidedAt: at, decisionRequestId: requestId };
}

async function acceptIn(
  tx: Transaction,
  actor: Principal,
  found: Found,
  request: Request & { readonly requestId: string },
): Promise<Done> {
  const { set, page } = found;
  const frontmatter = frontmatterSchema.safeParse(set.frontmatter);
  if (!frontmatter.success) return refused('invalid_frontmatter');
  const command = {
    command: 'update_page' as const,
    requestId: request.requestId,
    pageId: page.id,
    expectedVersion: set.baseVersion,
    slug: page.slug,
    title: set.title,
    parentId: page.parentId,
    frontmatter: frontmatter.data,
    bodyMd: set.bodyMd,
  };
  const checked = { command, statusFor: (stored: Page) => stored.status };
  const saved = await updateWithin(tx, actor, checked, request);
  if (!saved.ok) return saved;
  const done = { status: 'accepted', acceptedVersion: saved.page.version };
  await tx
    .update(pageSuggestionSets)
    .set({ ...done, ...decided(actor, request.at, request.requestId) })
    .where(eq(pageSuggestionSets.id, set.id));
  return saved;
}

async function replayed(tx: Transaction, actor: Principal, found: Found, at: Date): Promise<Done> {
  const version = found.set.acceptedVersion;
  if (version === null) return { ok: true, page: found.page };
  const kept = await pageVersion(tx, actor, { pageId: found.page.id, version }, at);
  return { ok: true, page: kept?.page ?? found.page };
}

export async function acceptSuggestion(
  db: Database,
  actor: Principal,
  command: AcceptSuggestionCommand,
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

export async function rejectSuggestion(
  db: Database,
  actor: Principal,
  command: RejectSuggestionCommand,
  _traceId: string,
  at: Date,
): Promise<Done> {
  if (actor.kind !== 'person') return refused('not_permitted');
  return db.transaction(async (tx) => {
    const found = await lockedSet(tx, actor, command, at);
    if ('ok' in found) return found;
    if ('replay' in found) return { ok: true, page: found.replay.page };
    await tx
      .update(pageSuggestionSets)
      .set({ status: 'rejected', ...decided(actor, at, command.requestId) })
      .where(eq(pageSuggestionSets.id, found.set.id));
    return { ok: true, page: found.page };
  });
}
