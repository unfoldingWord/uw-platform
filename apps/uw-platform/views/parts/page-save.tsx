import type { Context } from 'hono';
import {
  movePageCommandSchema,
  updatePageCommandSchema,
  type JdCategory,
  type Page,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../../deps.ts';
import { draftsOf } from '../../pages/drafts.ts';
import { renumbered, withJdId } from '../../pages/jd-ids.ts';
import { movePage } from '../../pages/move.ts';
import { updatePage } from '../../pages/store.ts';
import { renderPageEdit, type Typed } from '../screens/page-edit.tsx';
import { notFound } from '../screens/not-found.tsx';
import { screenKernel, screenRefusal, type ScreenKernel } from './frame.tsx';
import { backOf, shownPage } from './page-shown.ts';
import { idParam } from './params.ts';
import { pagePath, withBack } from './paths.ts';

type Posted = ReadonlyMap<string, unknown>;

type Outcome =
  { readonly ok: true; readonly version: number } | { readonly ok: false; readonly reason: string };

function text(posted: Posted, name: string): string | undefined {
  const value = posted.get(name);
  return typeof value === 'string' ? value : undefined;
}

function typedOf(page: Page, posted: Posted): Typed {
  const version = Number(posted.get('expectedVersion'));
  return {
    title: text(posted, 'title')?.trim() ?? page.title,
    bodyMd: text(posted, 'bodyMd')?.replace(/\r\n?/g, '\n') ?? page.bodyMd,
    expectedVersion: Number.isInteger(version) && version >= 1 ? version : page.version,
  };
}

type Saving = {
  readonly screen: ScreenKernel;
  readonly db: Database;
};

async function movedFirst(
  saving: Saving,
  page: Page,
  expectedVersion: number,
  moveTo: JdCategory | null,
): Promise<
  { readonly ok: true; readonly page: Page } | { readonly ok: false; readonly reason: string }
> {
  if (moveTo === null) return { ok: true, page };
  const command = movePageCommandSchema.safeParse({
    command: 'move_page',
    requestId: crypto.randomUUID(),
    pageId: page.id,
    expectedVersion,
    category: moveTo,
    parentId: null,
  });
  if (!command.success) return { ok: false, reason: 'malformed_command' };
  const { actor, traceId } = saving.screen.caller;
  return movePage(saving.db, actor, command.data, traceId, saving.screen.at);
}

async function saved(saving: Saving, page: Page, posted: Posted): Promise<Outcome> {
  const typed = typedOf(page, posted);
  const numbering = await renumbered(saving.db, page, typed.title);
  if (!numbering.ok) return numbering;
  const moved = await movedFirst(
    saving,
    page,
    Number(posted.get('expectedVersion')),
    numbering.moveTo,
  );
  if (!moved.ok) return moved;
  const current = moved.page;
  const command = updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted.get('requestId'),
    pageId: page.id,
    expectedVersion: current === page ? Number(posted.get('expectedVersion')) : current.version,
    slug: current.slug,
    title: typed.title,
    parentId: current.parentId,
    frontmatter: withJdId(current.frontmatter, numbering.jdId),
    bodyMd: typed.bodyMd,
    status: current.status,
  });
  if (!command.success) return { ok: false, reason: 'malformed_command' };
  const { actor, traceId } = saving.screen.caller;
  const result = await updatePage(saving.db, actor, command.data, traceId, saving.screen.at);
  return result.ok
    ? { ok: true, version: result.page.version }
    : { ok: false, reason: result.reason };
}

type Done = {
  readonly page: Page;
  readonly posted: Posted;
  readonly read: string;
  readonly back: string | null;
};

async function afterSave(c: Context<AppEnv>, done: Done, version: number): Promise<Response> {
  const opened = typedOf(done.page, done.posted).expectedVersion;
  const state = text(done.posted, 'draftState') ?? null;
  await draftsOf(c.env)?.close(done.page.id, opened, state);
  const mark = `saved=${String(version)}`;
  return c.redirect(`${done.read}${done.back === null ? '?' : '&'}${mark}`, 303);
}

export async function savePage(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const view = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  const shown = view.status === 'accepted' ? await shownPage(c, screen, pageId) : null;
  if (shown === null) return notFound(c);
  const posted = new Map(Object.entries(await c.req.parseBody()));
  const back = backOf(text(posted, 'back'));
  const read = withBack(pagePath(pageId), back);
  if (!shown.canEdit) {
    const refusal = { asText: false, back, refused: 'not_permitted', typed: null };
    return renderPageEdit(c, screen, pageId, refusal);
  }
  const database = c.get('database');
  if (database === null) return screenRefusal(c);
  const outcome = await saved({ screen, db: database.db }, shown.page, posted);
  if (outcome.ok) return afterSave(c, { page: shown.page, posted, read, back }, outcome.version);
  const typed = typedOf(shown.page, posted);
  const asText = text(posted, 'asText') === '1';
  return renderPageEdit(c, screen, pageId, { asText, back, refused: outcome.reason, typed });
}
