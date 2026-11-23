import type { Context } from 'hono';
import { updatePageCommandSchema, type Page } from '@uw/contracts';
import type { AppEnv } from '../../deps.ts';
import { draftsOf } from '../../pages/drafts.ts';
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

async function saved(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  page: Page,
  posted: Posted,
): Promise<Outcome> {
  const database = c.get('database');
  if (database === null) return { ok: false, reason: 'database_not_configured' };
  const typed = typedOf(page, posted);
  const command = updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted.get('requestId'),
    pageId: page.id,
    expectedVersion: Number(posted.get('expectedVersion')),
    slug: page.slug,
    title: typed.title,
    parentId: page.parentId,
    frontmatter: page.frontmatter,
    bodyMd: typed.bodyMd,
    status: page.status,
  });
  if (!command.success) return { ok: false, reason: 'malformed_command' };
  const { actor, traceId } = screen.caller;
  const result = await updatePage(database.db, actor, command.data, traceId, screen.at);
  return result.ok
    ? { ok: true, version: result.page.version }
    : { ok: false, reason: result.reason };
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
  const outcome = await saved(c, screen, shown.page, posted);
  if (outcome.ok) {
    await draftsOf(c.env)?.close(pageId, outcome.version - 1, text(posted, 'draftState') ?? null);
    const mark = `saved=${String(outcome.version)}`;
    return c.redirect(`${read}${back === null ? '?' : '&'}${mark}`, 303);
  }
  const typed = typedOf(shown.page, posted);
  const asText = text(posted, 'asText') === '1';
  return renderPageEdit(c, screen, pageId, { asText, back, refused: outcome.reason, typed });
}
