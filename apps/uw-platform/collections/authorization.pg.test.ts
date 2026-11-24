import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { viewSettingsSchema, type Principal, type SetPropertyCommand } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pageVersion } from '../pages/history.ts';
import { readPage } from '../pages/store.ts';
import { agentOf } from '../testing/kernel.ts';
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  replyOf,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { ensureBuiltIns } from './builtins/seed.ts';
import { createCollection } from './definition-commands.ts';
import { createRow, setProperty } from './rows.ts';
import { moveCard, saveTemplate, saveView } from './view-commands.ts';

type Rig = { readonly admin: Principal; readonly editor: Principal; readonly finance: Principal };

function withRig(work: (db: Database, rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    await ensureBuiltIns(db, collectionsAt);
    const admin = await personWith(db, 'ana', [
      { role: 'admin', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const editor = await personWith(db, 'ed', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const finance = await personWith(db, 'fin', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '20-29' },
      { role: 'viewer', area: '00-09' },
    ]);
    await defined(db, admin, testPortfolio);
    await defined(db, admin, testProgram);
    await work(db, { admin, editor, finance });
  });
}

function set(
  collection: string,
  rowId: string,
  property: string,
  value: SetPropertyCommand['value'],
) {
  return {
    command: 'set_property',
    requestId: randomUUID(),
    collection,
    rowId,
    property,
    value,
  } as const;
}

async function provesPageReadsWithhold(db: Database, { editor, finance }: Rig) {
  const row = await rowIn(db, finance, {
    collection: 'tportfolio',
    jdArea: '60-69',
    title: 'Bible',
  });
  accepted(await setProperty(db, set('tportfolio', row, 'cost', 900), requestOf(finance)));
  expect((await readPage(db, editor, row, collectionsAt))?.frontmatter).not.toHaveProperty('cost');
  expect((await readPage(db, finance, row, collectionsAt))?.frontmatter).toMatchObject({
    cost: 900,
  });
  const old = await pageVersion(db, editor, { pageId: row, version: 2 }, collectionsAt);
  expect(old?.page.frontmatter).not.toHaveProperty('cost');
}

async function provesRollupOfComputed(db: Database, { editor, finance }: Rig) {
  const portfolio = await rowIn(db, finance, {
    collection: 'tportfolio',
    jdArea: '60-69',
    title: 'Bible',
  });
  accepted(await setProperty(db, set('tportfolio', portfolio, 'cost', 40), requestOf(finance)));
  await rowIn(db, editor, {
    collection: 'tprogram',
    jdArea: '60-69',
    title: 'Program',
    values: { portfolio },
  });
  expect(
    (await replyOf(db, editor, 'tprogram')).rows[0]?.values['portfolio_total'],
  ).toBeUndefined();
  expect((await replyOf(db, finance, 'tprogram')).rows[0]?.values['portfolio_total']).toBe(40);
}

async function provesReverseRelationAcrossAreas(db: Database, { editor }: Rig) {
  const elsewhere = await personWith(db, 'far', [
    { role: 'editor', area: '70-79' },
    { role: 'viewer', area: '00-09' },
  ]);
  const reader = await personWith(db, 'peek', [
    { role: 'editor', area: '60-69' },
    { role: 'viewer', area: '70-79' },
    { role: 'viewer', area: '00-09' },
  ]);
  const mine = await rowIn(db, editor, { collection: 'program', jdArea: '60-69', title: 'Mine' });
  const theirs = await rowIn(db, elsewhere, {
    collection: 'program',
    jdArea: '70-79',
    title: 'Theirs',
  });
  const project = await rowIn(db, elsewhere, {
    collection: 'project',
    jdArea: '70-79',
    title: 'Far project',
    values: { program: theirs },
  });
  const blind = await setProperty(
    db,
    set('program', mine, 'projects', [project]),
    requestOf(editor),
  );
  expect(blind).toMatchObject({ reason: 'row_not_found' });
  const seen = await setProperty(
    db,
    set('program', mine, 'projects', [project]),
    requestOf(reader),
  );
  expect(seen).toMatchObject({ reason: 'not_permitted' });
  const read = await replyOf(db, elsewhere, 'project');
  expect(read.rows[0]?.values['program']).toEqual([{ id: theirs, title: 'Theirs' }]);
}

async function provesTemplateStaysHome(db: Database, { admin }: Rig) {
  const templateId = randomUUID();
  const template = (collection: string) =>
    ({
      command: 'save_template',
      requestId: randomUUID(),
      collection,
      templateId,
      name: 'T',
      values: {},
      bodyMd: '',
    }) as const;
  accepted(await saveTemplate(db, template('tprogram'), requestOf(admin)));
  expect(await saveTemplate(db, template('tportfolio'), requestOf(admin))).toMatchObject({
    reason: 'not_permitted',
  });
}

async function provesViewerCannotReorder(db: Database, { admin }: Rig) {
  const viewer = await personWith(db, 'vi', [{ role: 'viewer', area: '60-69' }]);
  const viewId = randomUUID();
  const settings = viewSettingsSchema.parse({
    name: 'Board',
    layout: 'board',
    scope: 'shared',
    group: { property: 'phase', by: 'value' },
    manualOrder: true,
  });
  accepted(
    await saveView(
      db,
      { command: 'save_view', requestId: randomUUID(), collection: 'tprogram', viewId, settings },
      requestOf(admin),
    ),
  );
  const row = await rowIn(db, admin, {
    collection: 'tprogram',
    jdArea: '60-69',
    title: 'A',
    values: { phase: 'idea' },
  });
  const move = {
    command: 'move_card',
    requestId: randomUUID(),
    viewId,
    rowId: row,
    group: 'idea',
    after: null,
    before: null,
  } as const;
  expect(await moveCard(db, move, requestOf(viewer))).toMatchObject({ reason: 'not_permitted' });
  const stray = { ...move, requestId: randomUUID(), after: randomUUID() };
  expect(await moveCard(db, stray, requestOf(admin))).toMatchObject({ reason: 'row_not_found' });
}

async function provesClosedReasons(db: Database, { admin, editor }: Rig) {
  const taken = { ...testProgram, key: 'second_program', pageType: 'program' as const };
  const org = await personWith(db, 'org', [{ role: 'admin', area: '60-69' }]);
  const refused = await createCollection(
    db,
    { command: 'create_collection', requestId: randomUUID(), definition: taken },
    requestOf(org),
  );
  expect(refused).toMatchObject({ reason: 'collection_exists' });
  const rowId = await rowIn(db, admin, { collection: 'tprogram', jdArea: '60-69', title: 'Once' });
  const again = {
    command: 'create_row',
    requestId: randomUUID(),
    collection: 'tprogram',
    rowId,
    jdArea: '60-69',
    title: 'Twice',
    values: {},
    template: null,
  } as const;
  expect(await createRow(db, again, requestOf(editor))).toMatchObject({ reason: 'page_exists' });
}

async function provesAgentsSuggest(db: Database, { editor }: Rig) {
  const agent = agentOf(editor, 'laptop');
  const rowId = randomUUID();
  const command = {
    command: 'create_row',
    requestId: rowId,
    collection: 'tasks',
    rowId,
    jdArea: '60-69',
    title: 'Agent task',
    values: { status: 'open' },
    template: null,
  } as const;
  accepted(await createRow(db, command, requestOf(agent)));
  expect(await createRow(db, command, requestOf(agent))).toMatchObject({
    status: 'accepted',
    rowId,
  });
  expect((await replyOf(db, editor, 'tasks')).rows[0]?.values['status']).toBe('suggested');
  expect(
    await setProperty(db, set('tasks', rowId, 'status', 'open'), requestOf(agent)),
  ).toMatchObject({ reason: 'not_permitted' });
  accepted(await setProperty(db, set('tasks', rowId, 'status', 'open'), requestOf(editor)));
}

describe.skipIf(!testServer)(
  '#206 a narrower property stays narrow outside the collection reader',
  () => {
    it('withholds it from a page read and a page version', () => withRig(provesPageReadsWithhold));
    it('empties a rollup of a computed property over it', () => withRig(provesRollupOfComputed));
  },
);

describe.skipIf(!testServer)('#206 writes stay inside the caller grants', () => {
  it('refuses a reverse relation onto rows the caller cannot read or write', () =>
    withRig(provesReverseRelationAcrossAreas));
  it('keeps a template in its own collection', () => withRig(provesTemplateStaysHome));
  it('refuses a reader reordering a shared board and a neighbour that is not a row', () =>
    withRig(provesViewerCannotReorder));
});

describe.skipIf(!testServer)('#206 conflicts and agents', () => {
  it('answers a taken page type and a taken row id with closed reasons', () =>
    withRig(provesClosedReasons));
  it('lands an agent task suggested, replays its retry and keeps confirming to a person', () =>
    withRig(provesAgentsSuggest));
});
