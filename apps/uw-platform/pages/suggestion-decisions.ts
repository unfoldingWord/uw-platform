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
import { lockedPage, updateWithin, type PageRefusal, type PageResult } from './store.ts';

type SetRow = typeof pageSuggestionSets.$inferSelect;

type Done = PageResult | PageRefusal;

type Request = { readonly traceId: string; readonly at: Date };

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

async function lockedSet(
  tx: Transaction,
  actor: Principal,
  suggestionId: string,
  at: Date,
): Promise<{ readonly set: SetRow; readonly page: Page } | PageRefusal> {
  const [set] = await tx
    .select()
    .from(pageSuggestionSets)
    .where(eq(pageSuggestionSets.id, suggestionId))
    .for('update');
  const page = set === undefined ? null : await lockedPage(tx, actor, set.pageId, at);
  if (set === undefined || page === null) return refused('suggestion_not_found');
  if (!can(actor, 'write', { kind: 'area', area: page.jdArea }, at)) {
    return refused('not_permitted');
  }
  if (set.status !== 'pending') return refused('suggestion_decided', { status: set.status });
  return { set, page };
}

function decided(actor: Principal, at: Date) {
  return { decidedBy: actor.identity, decidedAt: at };
}

async function acceptIn(
  tx: Transaction,
  actor: Principal,
  found: { readonly set: SetRow; readonly page: Page },
  request: Request,
): Promise<Done> {
  const { set, page } = found;
  const frontmatter = frontmatterSchema.safeParse(set.frontmatter);
  if (!frontmatter.success) return refused('invalid_frontmatter');
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
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
  await tx
    .update(pageSuggestionSets)
    .set({ status: 'accepted', acceptedVersion: saved.page.version, ...decided(actor, request.at) })
    .where(eq(pageSuggestionSets.id, set.id));
  return saved;
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
    const found = await lockedSet(tx, actor, command.suggestionId, at);
    if ('ok' in found) return found;
    if (found.page.version !== found.set.baseVersion) {
      return refused('stale_version', { pageId: found.page.id });
    }
    return acceptIn(tx, actor, found, { traceId, at });
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
    const found = await lockedSet(tx, actor, command.suggestionId, at);
    if ('ok' in found) return found;
    await tx
      .update(pageSuggestionSets)
      .set({ status: 'rejected', ...decided(actor, at) })
      .where(eq(pageSuggestionSets.id, found.set.id));
    return { ok: true, page: found.page };
  });
}
