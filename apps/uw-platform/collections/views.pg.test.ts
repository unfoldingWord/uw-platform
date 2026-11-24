import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { viewSettingsSchema, type Principal, type ViewSettings } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import {
  accepted,
  defined,
  personWith,
  replyOf,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { removeProperty } from './definition-commands.ts';
import { loadCollection } from './definitions.ts';
import { readRows } from './reader.ts';
import { moveCard, saveView } from './view-commands.ts';
import { viewById, viewsOf } from './view-rows.ts';

type Rig = { readonly admin: Principal; readonly editor: Principal; readonly viewer: Principal };

function withRig(work: (db: Database, rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    const admin = await personWith(db, 'ana', [{ role: 'admin', area: '60-69' }]);
    const editor = await personWith(db, 'ed', [{ role: 'editor', area: '60-69' }]);
    const viewer = await personWith(db, 'vi', [{ role: 'viewer', area: '60-69' }]);
    await defined(db, admin, testPortfolio);
    await defined(db, admin, testProgram);
    await work(db, { admin, editor, viewer });
  });
}

const board: ViewSettings = viewSettingsSchema.parse({
  name: 'By phase',
  layout: 'board',
  scope: 'shared',
  properties: [
    { property: 'phase', visible: true, width: 140 },
    { property: 'size', visible: false },
  ],
  sorts: [{ property: 'size', direction: 'desc' }],
  group: { property: 'phase', by: 'value' },
  groups: [{ value: 'running', visible: true, wipLimit: 1 }],
  manualOrder: true,
  filter: {
    kind: 'group',
    conjunction: 'and',
    children: [
      { kind: 'condition', property: 'size', operator: 'is_not_empty', value: null },
      {
        kind: 'group',
        conjunction: 'or',
        children: [
          { kind: 'condition', property: 'lead', operator: 'contains', value: { kind: 'me' } },
        ],
      },
    ],
  },
});

async function saved(db: Database, actor: Principal, settings: ViewSettings): Promise<string> {
  const viewId = randomUUID();
  accepted(
    await saveView(
      db,
      { command: 'save_view', requestId: randomUUID(), collection: 'tprogram', viewId, settings },
      requestOf(actor),
    ),
  );
  return viewId;
}

async function stored(db: Database) {
  const found = await loadCollection(db, 'tprogram');
  if (found === null) throw new Error('no collection');
  return found;
}

async function provesRoundTrip(db: Database, { editor, admin }: Rig) {
  const viewId = await saved(db, editor, board);
  expect((await viewById(db, await stored(db), viewId))?.settings).toEqual(board);
  const removal = {
    command: 'remove_property',
    requestId: randomUUID(),
    collection: 'tprogram',
    property: 'size',
  } as const;
  accepted(await removeProperty(db, removal, requestOf(admin)));
  const after = await viewById(db, await stored(db), viewId);
  expect(after?.settings.sorts).toEqual([]);
  expect(after?.settings.properties.map((p) => p.property)).toEqual(['phase']);
  expect(after?.settings.filter?.children).toHaveLength(1);
}

async function provesPersonalViews(db: Database, { editor, viewer }: Rig) {
  const mine = await saved(db, viewer, { ...board, name: 'Mine', scope: 'personal' });
  const theirs = await viewsOf(db, await stored(db), editor.personId);
  expect(theirs.map((v) => v.id)).not.toContain(mine);
  expect((await viewsOf(db, await stored(db), viewer.personId)).map((v) => v.id)).toContain(mine);
  const shared = await saveView(
    db,
    {
      command: 'save_view',
      requestId: randomUUID(),
      collection: 'tprogram',
      viewId: randomUUID(),
      settings: board,
    },
    requestOf(viewer),
  );
  expect(shared).toMatchObject({ reason: 'not_permitted' });
}

function move(
  viewId: string,
  rowId: string,
  group: string,
  after: string | null,
  before: string | null,
) {
  return {
    command: 'move_card',
    requestId: randomUUID(),
    viewId,
    rowId,
    group,
    after,
    before,
  } as const;
}

async function boardRows(db: Database, actor: Principal, viewId: string) {
  const collection = await stored(db);
  const view = await viewById(db, collection, viewId);
  const read = await readRows(db, collection, actor, new Date('2026-11-21T12:00:00.000Z'), {
    query: {
      filter: null,
      sorts: [],
      group: view?.settings.group ?? null,
      limit: 50,
      cursor: null,
    },
    view,
  });
  if (!read.ok) throw new Error(read.reason);
  return read.value.rows.map((row) => [row.title, row.group, row.version]);
}

async function provesDrag(db: Database, { editor }: Rig) {
  const viewId = await saved(db, editor, { ...board, filter: null, groups: [] });
  const program = { collection: 'tprogram', jdArea: '60-69' };
  const a = await rowIn(db, editor, { ...program, title: 'A', values: { phase: 'idea' } });
  const b = await rowIn(db, editor, { ...program, title: 'B', values: { phase: 'running' } });
  const command = move(viewId, a, 'running', null, b);
  expect(await moveCard(db, command, requestOf(editor))).toMatchObject({
    status: 'accepted',
    version: 2,
  });
  expect(await moveCard(db, command, requestOf(editor))).toMatchObject({
    status: 'accepted',
    version: 2,
  });
  expect(
    await moveCard(db, { ...command, requestId: randomUUID() }, requestOf(editor)),
  ).toMatchObject({ version: 2 });
  expect(await boardRows(db, editor, viewId)).toEqual([
    ['A', 'running', 2],
    ['B', 'running', 1],
  ]);
  accepted(await moveCard(db, move(viewId, a, 'running', b, null), requestOf(editor)));
  expect(await boardRows(db, editor, viewId)).toEqual([
    ['B', 'running', 1],
    ['A', 'running', 2],
  ]);
}

async function provesWipLimit(db: Database, { editor }: Rig) {
  const viewId = await saved(db, editor, { ...board, filter: null });
  const program = { collection: 'tprogram', jdArea: '60-69' };
  const a = await rowIn(db, editor, { ...program, title: 'A', values: { phase: 'idea' } });
  await rowIn(db, editor, { ...program, title: 'B', values: { phase: 'running' } });
  expect(
    await moveCard(db, move(viewId, a, 'running', null, null), requestOf(editor)),
  ).toMatchObject({ reason: 'wip_limit_reached' });
  const read = await replyOf(db, editor, 'tprogram', { group: { property: 'phase', by: 'value' } });
  expect(read.rows.find((row) => row.id === a)?.group).toBe('idea');
}

describe.skipIf(!testServer)('#206 saved views are normalized rows', () => {
  it('round-trips a view and loses only the rows of a deleted property', () =>
    withRig(provesRoundTrip));
  it('keeps a personal view to its person and a shared view to editors', () =>
    withRig(provesPersonalViews));
});

describe.skipIf(!testServer)('#206 dragging a card', () => {
  it('writes the property and its position, and a retry is safe', () => withRig(provesDrag));
  it('refuses a move into a group at its WIP limit and writes nothing', () =>
    withRig(provesWipLimit));
});
