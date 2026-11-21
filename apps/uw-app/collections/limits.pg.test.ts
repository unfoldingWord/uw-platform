import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { viewSettingsSchema, type Principal, type ViewSettings } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { collectionCardOrder } from '@uw/db/schema';
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  query,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';
import { changePropertyType, removeProperty } from './definition-commands.ts';
import { loadCollection } from './definitions.ts';
import { csvCell } from './read-handlers.ts';
import { viewRows } from './replies.ts';
import { moveCard, saveView } from './view-commands.ts';
import { viewById } from './view-rows.ts';

type Rig = { readonly admin: Principal };

function withRig(work: (db: Database, rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    const admin = await personWith(db, 'ana', [{ role: 'admin', area: '60-69' }]);
    await defined(db, admin, testPortfolio);
    await defined(db, admin, testProgram);
    await work(db, { admin });
  });
}

async function saved(db: Database, actor: Principal, raw: Partial<ViewSettings>): Promise<string> {
  const viewId = randomUUID();
  const settings = viewSettingsSchema.parse({
    name: 'View',
    layout: 'table',
    scope: 'shared',
    ...raw,
  });
  accepted(
    await saveView(
      db,
      { command: 'save_view', requestId: randomUUID(), collection: 'tprogram', viewId, settings },
      requestOf(actor),
    ),
  );
  return viewId;
}

async function order(db: Database, actor: Principal, viewId: string): Promise<string[]> {
  const stored = await loadCollection(db, 'tprogram');
  if (stored === null) throw new Error('no collection');
  const read = await viewRows(db, stored, actor, collectionsAt, {
    viewId,
    limit: 50,
    cursor: null,
  });
  if (!read.ok) throw new Error(read.reason);
  return read.value.rows.map((row) => row.title);
}

async function provesFirstDragKeepsOthers(db: Database, { admin }: Rig) {
  const viewId = await saved(db, admin, {
    layout: 'board',
    group: { property: 'phase', by: 'value' },
    manualOrder: true,
  });
  const ids = new Map<string, string>();
  for (const title of ['A', 'B', 'C', 'D']) {
    ids.set(
      title,
      await rowIn(db, admin, {
        collection: 'tprogram',
        jdArea: '60-69',
        title,
        values: { phase: 'idea' },
      }),
    );
  }
  const move = {
    command: 'move_card',
    requestId: randomUUID(),
    viewId,
    rowId: ids.get('D') ?? '',
    group: 'idea',
    after: ids.get('B') ?? null,
    before: ids.get('C') ?? null,
  } as const;
  accepted(await moveCard(db, move, requestOf(admin)));
  expect(await order(db, admin, viewId)).toEqual(['A', 'B', 'D', 'C']);
}

async function provesOldKeysKeepTheirOrder(db: Database, { admin }: Rig) {
  const viewId = await saved(db, admin, {
    layout: 'board',
    group: { property: 'phase', by: 'value' },
    manualOrder: true,
  });
  const ids = new Map<string, string>();
  for (const [title, position] of [
    ['A', 'V'],
    ['B', 'k'],
    ['C', 'r'],
  ] as const) {
    const values = { phase: 'idea' };
    const rowId = await rowIn(db, admin, {
      collection: 'tprogram',
      jdArea: '60-69',
      title,
      values,
    });
    ids.set(title, rowId);
    await db.insert(collectionCardOrder).values({ viewId, rowId, position });
  }
  expect(await order(db, admin, viewId)).toEqual(['A', 'B', 'C']);
  const move = {
    command: 'move_card',
    requestId: randomUUID(),
    viewId,
    rowId: ids.get('C') ?? '',
    group: 'idea',
    after: ids.get('A') ?? null,
    before: ids.get('B') ?? null,
  } as const;
  accepted(await moveCard(db, move, requestOf(admin)));
  expect(await order(db, admin, viewId)).toEqual(['A', 'C', 'B']);
  const stored = await db.select().from(collectionCardOrder);
  expect(
    stored.every((row) => /^[a-zA-Z][0-9A-Za-z]*$/.test(row.position) && row.position.length > 1),
  ).toBe(true);
}

async function provesExportPastAPage(db: Database, { admin }: Rig) {
  const viewId = await saved(db, admin, {});
  for (let n = 0; n < 205; n += 1) {
    await rowIn(db, admin, {
      collection: 'tprogram',
      jdArea: '60-69',
      title: `Row ${String(n).padStart(3, '0')}`,
    });
  }
  const csv = await getHtml(
    db,
    admin.email ?? '',
    `/api/collections/tprogram/views/${viewId}/export`,
    {},
    { now: () => collectionsAt },
  );
  expect(csv.headers.get('x-uw-export-cut')).toBe('false');
  expect(csv.text.trim().split('\n')).toHaveLength(206);
}

async function provesDefinitionGuards(db: Database, { admin }: Rig) {
  const removal = (collection: string, property: string) =>
    ({ command: 'remove_property', requestId: randomUUID(), collection, property }) as const;
  const rollupTarget = await removeProperty(db, removal('tportfolio', 'cost'), requestOf(admin));
  expect(rollupTarget).toMatchObject({ reason: 'definition_has_problems' });
  await saved(db, admin, { name: 'Calendar', layout: 'calendar', dateProperty: 'due' });
  expect(await removeProperty(db, removal('tprogram', 'due'), requestOf(admin))).toMatchObject({
    reason: 'definition_has_problems',
    problems: ['view Calendar dates by it'],
  });
}

async function provesTypeChangePrunesFilters(db: Database, { admin }: Rig) {
  const filter = {
    kind: 'group',
    conjunction: 'and',
    children: [{ kind: 'condition', property: 'size', operator: 'starts_with', value: '1' }],
  } as const;
  const viewId = await saved(db, admin, {
    filter,
    sorts: [{ property: 'size', direction: 'asc' }],
  });
  const change = {
    command: 'change_property_type',
    requestId: randomUUID(),
    collection: 'tprogram',
    property: 'size',
    config: { type: 'number', format: 'plain' },
  } as const;
  accepted(await changePropertyType(db, change, requestOf(admin)));
  const stored = await loadCollection(db, 'tprogram');
  const view = stored === null ? null : await viewById(db, stored, viewId);
  expect(view?.settings.filter?.children).toEqual([]);
  expect(view?.settings.sorts).toEqual([{ property: 'size', direction: 'asc' }]);
}

async function provesImpossibleDate(db: Database, { admin }: Rig) {
  const filter = {
    kind: 'group',
    conjunction: 'and',
    children: [{ kind: 'condition', property: 'due', operator: 'before', value: '2025-02-30' }],
  } as const;
  expect(await query(db, admin, 'tprogram', { filter })).toEqual({
    ok: false,
    reason: 'filter_not_valid',
  });
}

describe.skipIf(!testServer)('#206 manual order and long views', () => {
  it('keeps the cards nobody moved in place on the first drag in a column', () =>
    withRig(provesFirstDragKeepsOthers));
  it('re-keys a column holding keys from before fractional-indexing, in the order shown', () =>
    withRig(provesOldKeysKeepTheirOrder));
  it('exports every row of a view longer than one page', () => withRig(provesExportPastAPage));
});

describe.skipIf(!testServer)(
  '#206 a definition change keeps every collection and view whole',
  () => {
    it('refuses removing a property another collection or a view depends on', () =>
      withRig(provesDefinitionGuards));
    it('drops saved filters that no longer fit a changed type', () =>
      withRig(provesTypeChangePrunesFilters));
    it('refuses a date that does not exist', () => withRig(provesImpossibleDate));
  },
);

describe('#206 export cells', () => {
  it('neutralise a leading formula, tab or carriage return and quote line breaks', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});
