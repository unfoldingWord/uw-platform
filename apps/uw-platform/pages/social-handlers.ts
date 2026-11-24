import type { Context } from 'hono';
import { z } from 'zod';
import {
  commentPageCommandSchema,
  pageCommentsReplySchema,
  pageFavouriteReplySchema,
  resolveCommentCommandSchema,
} from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { addComment, commentsOf, resolveComment } from './comments.ts';
import { setFavourite } from './favourites.ts';

const pageParam = z.uuid();

function favouriteAs(on: boolean) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const actor = c.get('principal');
    if (actor === null) return refuse(c, 'unauthenticated');
    const pageId = pageParam.safeParse(c.req.param('pageId'));
    if (!pageId.success) return refuse(c, 'page_not_found');
    const favourite = await setFavourite(
      database.db,
      actor,
      { pageId: pageId.data, on },
      c.get('now'),
    );
    if (favourite === null) return refuse(c, 'page_not_found');
    c.set('outcome', 'accepted');
    const answer = { status: 'accepted', pageId: pageId.data, favourite };
    return c.json(pageFavouriteReplySchema.parse(answer), 200);
  };
}

export const keepFavourite = favouriteAs(true);
export const dropFavourite = favouriteAs(false);

export async function listComments(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const pageId = pageParam.safeParse(c.req.param('pageId'));
  const comments = pageId.success
    ? await commentsOf(database.db, actor, pageId.data, c.get('now'))
    : null;
  if (comments === null) return refuse(c, 'page_not_found');
  c.set('outcome', 'accepted');
  return c.json(pageCommentsReplySchema.parse({ comments }), 200);
}

export async function handleComment(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const parsed = commentPageCommandSchema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const done = await addComment(database.db, actor, parsed.data, c.get('now'));
  const { requestId } = parsed.data;
  return reply(
    c,
    done.ok
      ? { status: 'accepted', requestId }
      : { status: 'error', requestId, reason: done.reason },
  );
}

export async function handleResolve(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const parsed = resolveCommentCommandSchema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const done = await resolveComment(database.db, actor, parsed.data, c.get('now'));
  const { requestId } = parsed.data;
  return reply(
    c,
    done.ok
      ? { status: 'accepted', requestId }
      : { status: 'error', requestId, reason: done.reason },
  );
}
