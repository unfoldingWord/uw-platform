import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Principal, SetPropertyCommand } from '@uw/contracts';
import type { Database } from '@uw/db/client';

type JsonValue = SetPropertyCommand['value'];
import {
  accepted,
  collectionsAt,
  personWith,
  replyOf,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { builtInProblems, builtIns, ensureBuiltIns } from './builtins/seed.ts';
import { allCollections, loadCollection } from './definitions.ts';
import { viewRows } from './replies.ts';
import { setProperty } from './rows.ts';

const myTasks = 'c0110000-0000-4000-8000-000000000101';

type Rig = { readonly ana: Principal; readonly ben: Principal; readonly hr: Principal };

function withRig(work: (db: Database, rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    await ensureBuiltIns(db, collectionsAt);
    const ana = await personWith(db, 'ana', [
      { role: 'editor', area: '00-09' },
      { role: 'editor', area: '30-39' },
      { role: 'editor', area: '60-69' },
    ]);
    const ben = await personWith(db, 'ben', [{ role: 'viewer', area: '00-09' }]);
    const hr = await personWith(db, 'hr', [
      { role: 'viewer', area: '00-09' },
      { role: 'admin', area: '10-19' },
    ]);
    await work(db, { ana, ben, hr });
  });
}

function set(collection: string, rowId: string, property: string, value: JsonValue) {
  return {
    command: 'set_property',
    requestId: randomUUID(),
    collection,
    rowId,
    property,
    value,
  } as const;
}

async function viewTitles(db: Database, actor: Principal, key: string, viewId: string) {
  const stored = await loadCollection(db, key);
  if (stored === null) throw new Error('no collection');
  const read = await viewRows(db, stored, actor, collectionsAt, {
    viewId,
    limit: 50,
    cursor: null,
  });
  if (!read.ok) throw new Error(read.reason);
  return read.value.rows.map((row) => row.title);
}

async function provesSeeding(db: Database) {
  await ensureBuiltIns(db, collectionsAt);
  const keys = (await allCollections(db)).map((s) => s.definition.key);
  expect(keys).toEqual(['directory', 'okr', 'portfolio', 'program', 'project', 'tasks']);
  const views = builtIns.reduce((n, b) => n + b.views.length, 0);
  const program = builtIns.find((b) => b.id.endsWith('4'))?.views.length ?? 0;
  const project = builtIns.find((b) => b.id.endsWith('5'))?.views.length ?? 0;
  expect([program + project, views]).toEqual([16, 26]);
}

async function provesMyTasks(db: Database, { ana, ben }: Rig) {
  const tasks = { collection: 'tasks', jdArea: '30-39' };
  await rowIn(db, ana, {
    ...tasks,
    title: 'Rotate keys',
    values: { assignees: [ana.personId], status: 'in_progress', due: '2026-12-01' },
  });
  await rowIn(db, ana, {
    ...tasks,
    title: 'Patch host',
    values: { assignees: [ana.personId], status: 'open', due: '2026-11-25' },
  });
  await rowIn(db, ana, {
    ...tasks,
    title: 'Old ticket',
    values: { assignees: [ana.personId], status: 'done' },
  });
  await rowIn(db, ana, {
    ...tasks,
    title: 'Someone else',
    values: { assignees: [ben.personId], status: 'open' },
  });
  expect(await viewTitles(db, ana, 'tasks', myTasks)).toEqual(['Patch host', 'Rotate keys']);
  expect(await viewTitles(db, ben, 'tasks', myTasks)).toEqual([]);
}

async function provesClosedTime(db: Database, { ana }: Rig) {
  const row = await rowIn(db, ana, { collection: 'tasks', jdArea: '30-39', title: 'Close me' });
  accepted(await setProperty(db, set('tasks', row, 'status', 'done'), requestOf(ana)));
  const read = await replyOf(db, ana, 'tasks');
  expect(read.rows[0]?.values['completed_time']).toBe(collectionsAt.toISOString());
  const refused = await setProperty(db, set('tasks', row, 'area', '60-69'), requestOf(ana));
  expect(refused).toMatchObject({ reason: 'property_not_writable' });
}

async function provesDirectory(db: Database, { ben, hr }: Rig) {
  const benId = ben.personId ?? '';
  accepted(await setProperty(db, set('directory', benId, 'phone', '+1 555 0100'), requestOf(ben)));
  accepted(await setProperty(db, set('directory', benId, 'role', 'Translator'), requestOf(hr)));
  const own = await setProperty(db, set('directory', benId, 'role', 'Director'), requestOf(ben));
  expect(own).toMatchObject({ reason: 'not_permitted' });
  const seenByBen = await replyOf(db, ben, 'directory', {
    sorts: [{ property: 'name', direction: 'asc' }],
  });
  const benRow = seenByBen.rows.find((row) => row.id === benId);
  expect(benRow?.values).toMatchObject({ phone: '+1 555 0100', role: 'Translator' });
  const hrRow = seenByBen.rows.find((row) => row.id === hr.personId);
  expect(hrRow?.values['phone']).toBeNull();
  const colleague = await personWith(db, 'col', [{ role: 'viewer', area: '00-09' }]);
  const seen = await replyOf(db, colleague, 'directory');
  expect(seen.rows.find((row) => row.id === benId)?.values['phone']).toBeNull();
  expect(
    (await replyOf(db, hr, 'directory')).rows.find((row) => row.id === benId)?.values['phone'],
  ).toBe('+1 555 0100');
}

async function provesStrategy(db: Database, { ana }: Rig) {
  const area = '60-69';
  const portfolio = await rowIn(db, ana, {
    collection: 'portfolio',
    jdArea: area,
    title: 'Bible translation',
  });
  const program = await rowIn(db, ana, {
    collection: 'program',
    jdArea: area,
    title: 'Gateway languages',
    values: { portfolio },
  });
  await rowIn(db, ana, {
    collection: 'project',
    jdArea: area,
    title: 'Workshop in Nairobi',
    values: { program, phase: 'underway' },
  });
  const projects = await replyOf(db, ana, 'project');
  expect(projects.rows[0]?.values).toMatchObject({
    portfolio: ['Bible translation'],
    field_cost: { feed: 'budget', state: 'no_budget_lines' },
  });
  const programs = await replyOf(db, ana, 'program');
  expect(programs.rows[0]?.values['projects']).toEqual([
    { id: projects.rows[0]?.id, title: 'Workshop in Nairobi' },
  ]);
  expect(programs.rows[0]?.values['sage_program_id']).toEqual({
    feed: 'sage_program_id',
    state: 'not_wired',
  });
  const portfolios = await replyOf(db, ana, 'portfolio');
  expect(portfolios.rows[0]?.values['programs']).toEqual([
    { id: program, title: 'Gateway languages' },
  ]);
}

describe('#206 the built-in collections', () => {
  it('name only properties and collections that exist', () => {
    expect(builtInProblems()).toEqual([]);
  });
});

describe.skipIf(!testServer)('#206 seeding the built-in collections', () => {
  it('seeds six collections and their views once, through the same definitions', () =>
    withRig(provesSeeding));
});

describe.skipIf(!testServer)('#206 tasks are a record collection', () => {
  it('lists My Tasks by assignee me in the to-do and in-progress groups, by due date', () =>
    withRig(provesMyTasks));
  it('stamps the closed time on entering the complete group and keeps the area read-only', () =>
    withRig(provesClosedTime));
});

describe.skipIf(!testServer)('#206 the directory', () => {
  it('lets a person edit their contact fields and keeps them from colleagues', () =>
    withRig(provesDirectory));
});

describe.skipIf(!testServer)('#206 the strategy collections', () => {
  it('relate projects to programs both ways, roll the portfolio up and read money through', () =>
    withRig(provesStrategy));
});
