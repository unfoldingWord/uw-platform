import type { Context } from 'hono';
import { updatePageCommandSchema } from '@uw/contracts';
import type { PersonaDashboard } from '@uw/harness';
import type { AppEnv } from '../../deps.ts';
import { readPage, updatePage } from '../../pages/store.ts';
import { pageIdOf, readDashboard, renderPersona } from '../screens/persona.tsx';
import { notFound } from '../screens/not-found.tsx';
import { screenKernel, screenRefusal, type ScreenKernel } from './frame.tsx';
import type { SavedToolset } from './persona-controls.tsx';

type Posted = { readonly verbs: readonly string[]; readonly fields: Map<string, unknown> };

function postedOf(body: Record<string, unknown>): Posted {
  const raw = body['verb'];
  const verbs = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return {
    verbs: verbs.filter((verb): verb is string => typeof verb === 'string'),
    fields: new Map(Object.entries(body)),
  };
}

function chosenToolset(
  stored: unknown,
  options: readonly string[],
  posted: readonly string[],
): string[] {
  const offered = new Set(options);
  const picked = new Set(options.filter((verb) => posted.includes(verb)));
  const before = Array.isArray(stored)
    ? stored.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const kept = before.filter((entry) => !offered.has(entry) || picked.has(entry));
  const added = options.filter((verb) => picked.has(verb) && !before.includes(verb));
  return [...kept, ...added];
}

async function save(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  dashboard: PersonaDashboard,
  posted: Posted,
): Promise<SavedToolset> {
  const database = c.get('database');
  const options = dashboard.toolsetOptions;
  if (database === null || options === null) return { reason: 'not_permitted' };
  const { actor } = screen.caller;
  const page = await readPage(database.db, actor, dashboard.page.id, screen.at);
  if (page === null) return { reason: 'page_not_found' };
  const chosen = chosenToolset(page.frontmatter['toolset'], options, posted.verbs);
  const command = updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted.fields.get('requestId'),
    pageId: page.id,
    expectedVersion: Number(posted.fields.get('expectedVersion')),
    slug: page.slug,
    title: page.title,
    parentId: page.parentId,
    frontmatter: { ...page.frontmatter, toolset: chosen },
    bodyMd: page.bodyMd,
    status: page.status,
  });
  if (!command.success) return { reason: 'malformed_command' };
  const saved = await updatePage(
    database.db,
    actor,
    command.data,
    screen.caller.traceId,
    screen.at,
  );
  return saved.ok ? { accepted: true } : { reason: saved.reason };
}

export async function saveToolset(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const pageId = pageIdOf(c);
  if (screen === null) return screenRefusal(c);
  if (pageId === null) return notFound(c);
  const dashboard = () => screen.kernel.views.persona(screen.caller, { pageId }, { at: screen.at });
  const before = readDashboard(await dashboard());
  if (before === null) return notFound(c);
  const saved = await save(c, screen, before, postedOf(await c.req.parseBody({ all: true })));
  return renderPersona(c, readDashboard(await dashboard()) ?? before, saved);
}
