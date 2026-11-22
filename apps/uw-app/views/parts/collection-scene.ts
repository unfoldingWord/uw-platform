import type { Context } from 'hono';
import {
  rowQuerySchema,
  type CollectionRow,
  type FilterGroup,
  type RowQuery,
  type RowsReply,
  type SavedView,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import { formatDate } from '@uw/core/dates';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { coversOf } from '../../collections/covers.ts';
import { loadCollection, type StoredCollection } from '../../collections/definitions.ts';
import { namesFor } from '../../collections/display.ts';
import { mayReadCollection, readGroupSums, readRows } from '../../collections/reader.ts';
import { viewsOf } from '../../collections/view-rows.ts';
import { activePeople } from '../../people/directory.ts';
import { monthBounds } from './collection-calendar.tsx';
import type { LayoutProps } from './collection-layouts.tsx';
import type { ScreenKernel } from './frame.tsx';

export type CollectionScene = {
  readonly stored: StoredCollection;
  readonly views: readonly SavedView[];
  readonly view: SavedView | null;
  readonly layout: LayoutProps | null;
  readonly refusal: string | null;
};

type Db = NonNullable<AppEnv['Variables']['database']>['db'];

function cursorOf(c: Context<AppEnv>): string | null {
  const asked = c.req.query('cursor') ?? '';
  return /^[0-9]{1,7}$/.test(asked) ? asked : null;
}

export function monthOf(c: Context<AppEnv> | null, at: Date): string {
  const asked = c?.req.query('month') ?? '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : formatDate(at).slice(0, 7);
}

function withMonth(view: SavedView, month: string): FilterGroup | null {
  const { filter, dateProperty } = view.settings;
  if (view.settings.layout !== 'calendar' || dateProperty === null) return filter;
  const [first, last] = monthBounds(month);
  const within: FilterGroup = {
    kind: 'group',
    conjunction: 'and',
    children: [
      {
        kind: 'condition',
        property: dateProperty,
        operator: 'on_or_before',
        value: { kind: 'date', date: last },
      },
      {
        kind: 'condition',
        property: dateProperty,
        operator: 'on_or_after',
        value: { kind: 'date', date: first },
      },
    ],
  };
  return filter === null
    ? within
    : { kind: 'group', conjunction: 'and', children: [filter, within] };
}

async function peopleChoices(db: Db) {
  const everyone = await activePeople(db);
  return everyone.map((person) => ({ value: person.personId, label: person.email }));
}

async function sumsOf(
  db: Db,
  screen: ScreenKernel,
  stored: StoredCollection,
  view: SavedView,
  query: RowQuery,
) {
  const sum = view.settings.layout === 'chart' ? (view.settings.chart?.sum ?? null) : null;
  if (sum === null) return null;
  return readGroupSums(db, stored, screen.caller.actor, screen.at, { query, sum });
}

export async function layoutOf(
  db: Db,
  screen: ScreenKernel,
  stored: StoredCollection,
  view: SavedView,
  place: { readonly month: string; readonly cursor: string | null },
) {
  const { actor } = screen.caller;
  const { month, cursor } = place;
  const { sorts, group, layout } = view.settings;
  const limit = layout === 'board' || layout === 'chart' || layout === 'calendar' ? 200 : 100;
  const filter = withMonth(view, month);
  const query = rowQuerySchema.parse({ filter, sorts, group, limit, cursor });
  const read = await readRows(db, stored, actor, screen.at, { query, view });
  if (!read.ok) return { refusal: read.reason, layout: null };
  const reply: RowsReply = read.value;
  const covers = view.settings.cover
    ? await coversOf(
        db,
        reply.rows.map((row) => row.id),
      )
    : new Map<string, string>();
  return {
    refusal: null,
    layout: {
      definition: stored.definition,
      reply,
      names: await namesFor(db, reply.rows, stored.definition.properties),
      mayWrite: (row: CollectionRow) =>
        stored.definition.rowSource !== 'people' &&
        row.jdArea !== null &&
        can(actor, 'write', { kind: 'area', area: row.jdArea }, screen.at),
      people: await peopleChoices(db),
      covers,
      month,
      sums: await sumsOf(db, screen, stored, view, query),
    },
  };
}

function chosenView(
  views: readonly SavedView[],
  viewId: string | null,
): SavedView | null | undefined {
  if (viewId === null) return views[0] ?? null;
  return views.find((v) => v.id === viewId);
}

export async function collectionScene(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  viewId: string | null,
): Promise<CollectionScene | null> {
  const database = c.get('database');
  if (database === null) return null;
  await ensureBuiltIns(database.db, screen.at);
  const stored = await loadCollection(database.db, c.req.param('key') ?? '');
  if (stored === null || !mayReadCollection(stored, screen.caller.actor, screen.at)) return null;
  const views = await viewsOf(database.db, stored, screen.caller.actor.personId);
  const view = chosenView(views, viewId);
  if (view === undefined) return null;
  if (view === null) return { stored, views, view, layout: null, refusal: null };
  const place = { month: monthOf(c, screen.at), cursor: cursorOf(c) };
  const shown = await layoutOf(database.db, screen, stored, view, place);
  return { stored, views, view, ...shown };
}
