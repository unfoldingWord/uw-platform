import type { Child } from 'hono/jsx';
import type { Rendered } from '../../markdown/render.ts';
import { placedViews, type Placed } from '../../markdown/view-embeds.ts';
import { loadCollection } from '../../collections/definitions.ts';
import { mayReadCollection } from '../../collections/reader.ts';
import { viewById } from '../../collections/view-rows.ts';
import { drawLayout } from './collection-draw.tsx';
import { layoutOf, monthOf } from './collection-scene.ts';
import type { ScreenKernel } from './frame.tsx';
import { pageLink } from './page-shown.ts';
import { collectionViewPath } from './paths.ts';
import type { AppEnv } from '../../deps.ts';

type Db = NonNullable<AppEnv['Variables']['database']>['db'];

const DENIED = '<p data-embed-notice="">You do not have access to this view.</p>';

async function shown(db: Db, screen: ScreenKernel, placed: Placed): Promise<Child | null> {
  const stored = await loadCollection(db, placed.collection);
  if (stored === null || !mayReadCollection(stored, screen.caller.actor, screen.at)) return null;
  const view = await viewById(db, stored, placed.viewId);
  if (view === null || (view.ownerId !== null && view.ownerId !== screen.caller.actor.personId))
    return null;
  const place = { month: monthOf(null, screen.at), cursor: null };
  const drawn = await layoutOf(db, screen, stored, view, place);
  if (drawn.layout === null) return null;
  return (
    <section
      data-view-embed-shown={view.id}
      aria-label={`${stored.definition.name}: ${view.settings.name}`}
      class="mt-4 mb-4 flex flex-col gap-2"
    >
      <p class="m-0 text-sm">
        <a href={collectionViewPath(stored.definition.key, view.id)} class={pageLink}>
          {`${stored.definition.name}: ${view.settings.name}`}
        </a>
      </p>
      {drawLayout(view.settings.layout, drawn.layout)}
      {drawn.layout.reply.next === null ? null : (
        <p class="m-0 text-xs text-text-3">
          Showing the first rows. Open the view to see the rest.
        </p>
      )}
    </section>
  );
}

export const MOST_EMBEDDED_VIEWS = 10;

const CAPPED =
  '<p data-embed-notice="">This page shows at most ten views. Open this one from its link.</p>';

async function blockFor(db: Db, screen: ScreenKernel, placed: Placed): Promise<string> {
  const block = await shown(db, screen, placed);
  return block === null ? DENIED : String(await (<>{block}</>).toString());
}

export async function withViews(
  db: Db,
  screen: ScreenKernel,
  rendered: Rendered,
): Promise<Rendered> {
  const placed = placedViews(rendered.html);
  if (placed.length === 0) return rendered;
  const drawn = new Map<string, string>();
  let html = '';
  let from = 0;
  for (const each of placed) {
    const key = `${each.collection}/${each.viewId}`;
    const known = drawn.get(key);
    const capped = known === undefined && drawn.size >= MOST_EMBEDDED_VIEWS;
    const text = capped ? CAPPED : (known ?? (await blockFor(db, screen, each)));
    if (!capped) drawn.set(key, text);
    html += rendered.html.slice(from, each.start) + text;
    from = each.end;
  }
  return { ...rendered, html: html + rendered.html.slice(from) };
}
