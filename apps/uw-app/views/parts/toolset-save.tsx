import type { Context } from 'hono';
import { engineSchema, runShapeSchema, updatePageCommandSchema } from '@uw/contracts';
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

type Frontmatter = Readonly<Record<string, unknown>>;

const BUDGET_LIMIT_MINOR = 100_000_000_00;

function text(posted: Posted, name: string): string | undefined {
  const value = posted.fields.get(name);
  return typeof value === 'string' ? value : undefined;
}

function budgetOf(stored: Frontmatter, posted: Posted): unknown {
  const raw = text(posted, 'budget')?.trim();
  const budget = stored['budget'];
  if (raw === undefined) return budget;
  const minor = Math.round(Number(raw) * 100);
  const valid = raw !== '' && Number.isSafeInteger(minor) && minor >= 0;
  if (!valid || minor > BUDGET_LIMIT_MINOR) return null;
  const old = typeof budget === 'object' && budget !== null ? budget : {};
  return { ...old, monthly_minor: minor };
}

function engineOf(stored: Frontmatter, posted: Posted): Frontmatter {
  const engine = engineSchema.safeParse(text(posted, 'engine'));
  if (!engine.success || engine.data === stored['engine']) return {};
  return { engine: engine.data, provider: null };
}

function settingsOf(stored: Frontmatter, posted: Posted): Frontmatter {
  const shape = runShapeSchema.safeParse(text(posted, 'run_shape'));
  const model = text(posted, 'model')?.trim();
  return {
    ...(shape.success ? { run_shape: shape.data } : {}),
    ...engineOf(stored, posted),
    ...(model === undefined ? {} : { model }),
    budget: budgetOf(stored, posted),
  };
}

type StoredPage = NonNullable<Awaited<ReturnType<typeof readPage>>>;

function updateOf(page: StoredPage, posted: Posted, options: readonly string[]) {
  const chosen = chosenToolset(page.frontmatter['toolset'], options, posted.verbs);
  const retiring = text(posted, 'retire') === 'retire';
  const status = retiring ? 'retired' : page.status;
  const frontmatter = {
    ...page.frontmatter,
    ...settingsOf(page.frontmatter, posted),
    toolset: chosen,
    ...(retiring ? { status } : {}),
  };
  return updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted.fields.get('requestId'),
    pageId: page.id,
    expectedVersion: Number(posted.fields.get('expectedVersion')),
    slug: page.slug,
    title: page.title,
    parentId: page.parentId,
    frontmatter,
    bodyMd: text(posted, 'bodyMd')?.replace(/\r\n?/g, '\n') ?? page.bodyMd,
    status,
  });
}

async function save(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  dashboard: PersonaDashboard,
  posted: Posted,
): Promise<SavedToolset> {
  const database = c.get('database');
  const options = dashboard.toolsetOptions;
  if (database === null || options === null || !dashboard.canEdit) {
    return { reason: 'not_permitted' };
  }
  const { actor } = screen.caller;
  const page = await readPage(database.db, actor, dashboard.page.id, screen.at);
  if (page === null) return { reason: 'page_not_found' };
  const command = updateOf(page, posted, options);
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
