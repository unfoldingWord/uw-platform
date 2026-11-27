import { and, eq, sql } from 'drizzle-orm';
import type { ErrorReason, Page, UpdatePageCommand } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Transaction } from '@uw/db/client';
import { pageReviewSets, pageSuggestedChanges } from '@uw/db/schema';
import { canonicalJson } from '../pdf/provenance.ts';
import { embedsItself, resolveBody } from './links.ts';
import { writeChanges } from './review-sets.ts';
import { checkFrontmatter } from './validate.ts';
import type { PageRefusal, PageResult } from './store.ts';
import { suggestedChangesBetween } from './word-diff.ts';

const AGENT_SET_NAME = 'Suggested by an agent';

type Done = PageResult | PageRefusal;

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

function moved(stored: Page, full: UpdatePageCommand): readonly string[] {
  return [
    ...(full.slug === stored.slug ? [] : ['slug']),
    ...(full.parentId === stored.parentId ? [] : ['parentId']),
  ];
}

function storedFrontmatter(stored: Page): unknown {
  const checked = checkFrontmatter(stored.type, stored.frontmatter);
  return checked.ok ? checked.frontmatter : stored.frontmatter;
}

function proposedOver(stored: Page, full: UpdatePageCommand) {
  const sameFrontmatter =
    canonicalJson(full.frontmatter) === canonicalJson(storedFrontmatter(stored));
  return {
    title: full.title === stored.title ? null : full.title,
    frontmatter: sameFrontmatter ? null : full.frontmatter,
  };
}

async function heldSet(tx: Transaction, pageId: string, author: string) {
  const mine = and(
    eq(pageReviewSets.pageId, pageId),
    eq(pageReviewSets.createdBy, author),
    eq(pageReviewSets.status, 'pending'),
  );
  const [open] = await tx
    .select({ id: pageReviewSets.id })
    .from(pageReviewSets)
    .where(mine)
    .for('update');
  return open?.id ?? null;
}

type Proposal = {
  readonly baseVersion: number;
  readonly title: string | null;
  readonly frontmatter: Readonly<Record<string, unknown>> | null;
};

async function replaced(tx: Transaction, reviewSetId: string, proposal: Proposal): Promise<void> {
  await tx.delete(pageSuggestedChanges).where(eq(pageSuggestedChanges.reviewSetId, reviewSetId));
  await tx
    .update(pageReviewSets)
    .set({ ...proposal, revision: sql`${pageReviewSets.revision} + 1` })
    .where(eq(pageReviewSets.id, reviewSetId));
}

export async function holdAsReviewSet(
  tx: Transaction,
  actor: Principal,
  stored: Page,
  full: UpdatePageCommand,
  at: Date,
): Promise<Done> {
  const fields = moved(stored, full);
  if (fields.length > 0) return refused('malformed_command', { fields });
  const bodyMd = await resolveBody(tx, actor, { bodyMd: full.bodyMd, area: stored.jdArea }, at);
  if (await embedsItself(tx, stored.id, bodyMd)) return refused('embed_cycle');
  const changes = suggestedChangesBetween(stored.bodyMd, bodyMd);
  const proposal = { baseVersion: stored.version, ...proposedOver(stored, full) };
  if (changes.length === 0 && proposal.title === null && proposal.frontmatter === null) {
    return { ok: true, page: stored };
  }
  const open = await heldSet(tx, stored.id, actor.identity);
  const reviewSetId = open ?? crypto.randomUUID();
  if (open === null) {
    await tx.insert(pageReviewSets).values({
      id: reviewSetId,
      pageId: stored.id,
      name: AGENT_SET_NAME,
      status: 'pending',
      createdBy: actor.identity,
      createdAt: at,
      requestId: full.requestId,
      ...proposal,
    });
  } else {
    await replaced(tx, reviewSetId, proposal);
  }
  await writeChanges(tx, { reviewSetId, author: actor.identity, at }, changes);
  return { ok: true, page: stored, reviewSetId };
}
