import type { Context } from 'hono';
import { updatePageCommandSchema, type Page } from '@uw/contracts';
import type { AppEnv } from '../../deps.ts';
import { readPage, updatePage } from '../../pages/store.ts';
import { backOf, renderPage, type PageNotice } from '../screens/page.tsx';
import { notFound } from '../screens/not-found.tsx';
import { screenKernel, screenRefusal, type ScreenKernel } from './frame.tsx';
import { idParam } from './params.ts';

type Posted = ReadonlyMap<string, unknown>;

function text(posted: Posted, name: string): string | undefined {
  const value = posted.get(name);
  return typeof value === 'string' ? value : undefined;
}

function commandOf(page: Page, posted: Posted) {
  return updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted.get('requestId'),
    pageId: page.id,
    expectedVersion: Number(posted.get('expectedVersion')),
    slug: page.slug,
    title: text(posted, 'title')?.trim() ?? page.title,
    parentId: page.parentId,
    frontmatter: page.frontmatter,
    bodyMd: text(posted, 'bodyMd')?.replace(/\r\n?/g, '\n') ?? page.bodyMd,
    status: page.status,
  });
}

async function saved(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  pageId: string,
  posted: Posted,
): Promise<PageNotice> {
  const database = c.get('database');
  if (database === null) return { kind: 'refused', reason: 'database_not_configured' };
  const { actor, traceId } = screen.caller;
  const page = await readPage(database.db, actor, pageId, screen.at);
  if (page === null) return { kind: 'refused', reason: 'page_not_found' };
  const command = commandOf(page, posted);
  if (!command.success) return { kind: 'refused', reason: 'malformed_command' };
  const result = await updatePage(database.db, actor, command.data, traceId, screen.at);
  return result.ok ? { kind: 'saved' } : { kind: 'refused', reason: result.reason };
}

export async function savePage(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const read = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  if (read.status !== 'accepted') return notFound(c);
  const posted = new Map(Object.entries(await c.req.parseBody()));
  const notice = await saved(c, screen, pageId, posted);
  return renderPage(c, screen, pageId, { back: backOf(text(posted, 'back')), notice });
}
