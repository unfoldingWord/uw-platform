import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CommentPageCommand,
  ErrorReason,
  PageComment,
  ResolveCommentCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageComments, pages, people } from '@uw/db/schema';
import { readPage } from './store.ts';

type Done = { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

const MOST_SHOWN = 500;

export async function addComment(
  db: Executor,
  actor: Principal,
  command: CommentPageCommand,
  at: Date,
): Promise<Done> {
  const page = await readPage(db, actor, command.pageId, at);
  if (page === null) return { ok: false, reason: 'page_not_found' };
  await db
    .insert(pageComments)
    .values({
      id: command.commentId,
      pageId: page.id,
      author: actor.identity,
      bodyMd: command.bodyMd.trim(),
      createdAt: at,
    })
    .onConflictDoNothing();
  return { ok: true };
}

export async function resolveComment(
  db: Executor,
  actor: Principal,
  command: ResolveCommentCommand,
  at: Date,
): Promise<Done> {
  const [found] = await db
    .select({ author: pageComments.author, area: pages.jdArea })
    .from(pageComments)
    .innerJoin(pages, eq(pages.id, pageComments.pageId))
    .where(eq(pageComments.id, command.commentId));
  const area = { kind: 'area', area: found?.area ?? '' } as const;
  if (found === undefined || !can(actor, 'read', area, at)) {
    return { ok: false, reason: 'page_not_found' };
  }
  if (found.author !== actor.identity && !can(actor, 'write', area, at)) {
    return { ok: false, reason: 'not_permitted' };
  }
  await db
    .update(pageComments)
    .set({ resolvedAt: at, resolvedBy: actor.identity })
    .where(and(eq(pageComments.id, command.commentId), isNull(pageComments.resolvedAt)));
  return { ok: true };
}

export async function commentsOf(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<readonly PageComment[] | null> {
  if ((await readPage(db, actor, pageId, at)) === null) return null;
  const rows = await db
    .select({ comment: pageComments, name: people.displayName })
    .from(pageComments)
    .leftJoin(people, sql`${pageComments.author} = 'human:' || ${people.id}::text`)
    .where(eq(pageComments.pageId, pageId))
    .orderBy(asc(pageComments.createdAt), asc(pageComments.id))
    .limit(MOST_SHOWN);
  return rows.map(({ comment, name }) => ({
    id: comment.id,
    pageId: comment.pageId,
    author: comment.author,
    authorName: name,
    bodyMd: comment.bodyMd,
    createdAt: comment.createdAt.toISOString(),
    resolvedAt: comment.resolvedAt?.toISOString() ?? null,
  }));
}

export async function openComments(db: Executor, pageId: string): Promise<number> {
  const [row] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(pageComments)
    .where(and(eq(pageComments.pageId, pageId), isNull(pageComments.resolvedAt)));
  return row?.open ?? 0;
}
