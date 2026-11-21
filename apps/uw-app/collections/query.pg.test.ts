import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type FilterCondition,
  type FilterGroup,
  type Principal,
  type SetPropertyCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';

type JsonValue = SetPropertyCommand['value'];
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  query,
  replyOf,
  requestOf,
  rowIn,
  titles,
} from '../testing/collections.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { changePropertyType } from './definition-commands.ts';
import { setProperty } from './rows.ts';

type Rig = {
  readonly admin: Principal;
  readonly editor: Principal;
  readonly outsider: Principal;
  readonly finance: Principal;
};

function withRig(work: (db: Database, rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    const admin = await personWith(db, 'ana', [{ role: 'admin', area: '60-69' }]);
    const editor = await personWith(db, 'ed', [{ role: 'editor', area: '60-69' }]);
    const outsider = await personWith(db, 'out', [{ role: 'viewer', area: '30-39' }]);
    const finance = await personWith(db, 'fin', [
      { role: 'viewer', area: '60-69' },
      { role: 'viewer', area: '20-29' },
    ]);
    await defined(db, admin, testPortfolio);
    await defined(db, admin, testProgram);
    await work(db, { admin, editor, outsider, finance });
  });
}

function where(...children: (FilterCondition | FilterGroup)[]): FilterGroup {
  return { kind: 'group', conjunction: 'and', children };
}

function condition(
  property: string,
  operator: FilterCondition['operator'],
  value: FilterCondition['value'],
): FilterCondition {
  return { kind: 'condition', property, operator, value };
}

function set(rowId: string, property: string, value: JsonValue, collection = 'tprogram') {
  return {
    command: 'set_property',
    requestId: randomUUID(),
    collection,
    rowId,
    property,
    value,
  } as const;
}

async function provesRelativeValues(db: Database, { editor, admin }: Rig) {
  const program = { collection: 'tprogram', jdArea: '60-69' };
  await rowIn(db, editor, {
    ...program,
    title: 'Mine',
    values: { lead: [editor.personId], due: '2026-11-21' },
  });
  await rowIn(db, editor, {
    ...program,
    title: 'Theirs',
    values: { lead: [admin.personId], due: '2026-11-10' },
  });
  await rowIn(db, editor, { ...program, title: 'Later', values: { due: '2027-02-01' } });
  const mine = where(condition('lead', 'contains', { kind: 'me' }));
  expect(await titles(db, editor, 'tprogram', { filter: mine })).toEqual(['Mine']);
  const today = where(condition('due', 'is', { kind: 'today' }));
  expect(await titles(db, editor, 'tprogram', { filter: today })).toEqual(['Mine']);
  const weeks = { kind: 'relative', direction: 'past', unit: 'week', amount: 2 } as const;
  const lately = where(condition('due', 'within', weeks));
  expect(await titles(db, editor, 'tprogram', { filter: lately })).toEqual(['Mine', 'Theirs']);
  const later = where(condition('due', 'after', { kind: 'today' }));
  const either: FilterGroup = { kind: 'group', conjunction: 'or', children: [mine, later] };
  expect(await titles(db, editor, 'tprogram', { filter: either })).toEqual(['Later', 'Mine']);
}

async function provesAreaGrant(db: Database, { editor, outsider }: Rig) {
  await rowIn(db, editor, { collection: 'tprogram', jdArea: '60-69', title: 'Field' });
  expect(await query(db, outsider, 'tprogram')).toEqual({
    ok: false,
    reason: 'collection_not_found',
  });
  const both = await personWith(db, 'mix', [
    { role: 'editor', area: '70-79' },
    { role: 'viewer', area: '60-69' },
  ]);
  await rowIn(db, both, { collection: 'tprogram', jdArea: '70-79', title: 'Other area' });
  expect(await titles(db, editor, 'tprogram')).toEqual(['Field']);
  expect(await titles(db, both, 'tprogram')).toEqual(['Field', 'Other area']);
}

async function costedPortfolio(db: Database, editor: Principal): Promise<string> {
  const p = await rowIn(db, editor, { collection: 'tportfolio', jdArea: '60-69', title: 'Bible' });
  const costs = await personWith(db, 'costs', [
    { role: 'editor', area: '60-69' },
    { role: 'viewer', area: '20-29' },
  ]);
  accepted(await setProperty(db, set(p, 'cost', 1200, 'tportfolio'), requestOf(costs)));
  const refused = await setProperty(db, set(p, 'cost', 1, 'tportfolio'), requestOf(editor));
  expect(refused).toMatchObject({ reason: 'property_not_writable' });
  await rowIn(db, editor, {
    collection: 'tprogram',
    jdArea: '60-69',
    title: 'Translation',
    values: { portfolio: p },
  });
  return p;
}

async function provesPropertyRule(db: Database, { editor, finance }: Rig) {
  await costedPortfolio(db, editor);
  const blind = await replyOf(db, editor, 'tportfolio');
  expect(blind.withheld).toEqual(['cost']);
  expect(blind.rows[0]?.values).not.toHaveProperty('cost');
  const filter = where(condition('cost', 'gt', 0));
  const refused = { ok: false, reason: 'property_not_readable' };
  expect(await query(db, editor, 'tportfolio', { filter })).toEqual(refused);
  expect(
    await query(db, editor, 'tportfolio', { sorts: [{ property: 'cost', direction: 'asc' }] }),
  ).toEqual(refused);
  const rolled = await replyOf(db, editor, 'tprogram');
  expect(rolled.rows[0]?.values['portfolio_cost']).toBeUndefined();
  expect(rolled.rows[0]?.values['portfolio_count']).toBe(1);
  expect((await replyOf(db, finance, 'tprogram')).rows[0]?.values['portfolio_cost']).toBe(1200);
  expect(await titles(db, finance, 'tportfolio', { filter })).toEqual(['Bible']);
}

async function provesReadThrough(db: Database, { editor }: Rig) {
  const row = await rowIn(db, editor, { collection: 'tprogram', jdArea: '60-69', title: 'Funded' });
  const read = await replyOf(db, editor, 'tprogram');
  expect(read.rows[0]?.values['budget']).toEqual({ feed: 'budget', state: 'not_wired' });
  const refused = await setProperty(db, set(row, 'budget', 100), requestOf(editor));
  expect(refused).toMatchObject({ status: 'error', reason: 'property_not_writable' });
  const filter = where(condition('budget', 'gt', 0));
  expect(await query(db, editor, 'tprogram', { filter })).toEqual({
    ok: false,
    reason: 'property_not_queryable',
  });
}

async function provesGrouping(db: Database, { editor }: Rig) {
  const program = { collection: 'tprogram', jdArea: '60-69' };
  await rowIn(db, editor, { ...program, title: 'B', values: { phase: 'closed' } });
  await rowIn(db, editor, { ...program, title: 'A', values: { phase: 'running' } });
  await rowIn(db, editor, { ...program, title: 'C', values: { phase: 'idea', due: '2026-11-25' } });
  const sorted = await titles(db, editor, 'tprogram', {
    sorts: [{ property: 'phase', direction: 'asc' }],
  });
  expect(sorted).toEqual(['C', 'A', 'B']);
  const grouped = await replyOf(db, editor, 'tprogram', {
    group: { property: 'phase', by: 'status_group' },
  });
  expect(grouped.groups?.map((g) => [g.value, g.count])).toEqual([
    ['to_do', 1],
    ['in_progress', 1],
    ['complete', 1],
  ]);
  expect(grouped.rows.find((r) => r.title === 'C')?.values['days_left']).toBe(4);
}

async function provesTypeChange(db: Database, { admin, editor }: Rig) {
  const program = { collection: 'tprogram', jdArea: '60-69' };
  const fits = await rowIn(db, editor, { ...program, title: 'Fits', values: { size: '12' } });
  const unfit = await rowIn(db, editor, { ...program, title: 'Unfit', values: { size: 'large' } });
  const config = { type: 'number', format: 'plain' } as const;
  const change = () =>
    ({
      command: 'change_property_type',
      requestId: randomUUID(),
      collection: 'tprogram',
      property: 'size',
      config,
    }) as const;
  expect(await changePropertyType(db, change(), requestOf(admin))).toMatchObject({
    reason: 'rows_do_not_fit',
    rows: [unfit],
  });
  accepted(await setProperty(db, set(unfit, 'size', '3'), requestOf(editor)));
  expect(await changePropertyType(db, change(), requestOf(admin))).toMatchObject({
    status: 'accepted',
    version: 2,
  });
  const read = await replyOf(db, editor, 'tprogram', {
    sorts: [{ property: 'size', direction: 'desc' }],
  });
  expect(read.rows.map((r) => [r.id, r.values['size']])).toEqual([
    [fits, 12],
    [unfit, 3],
  ]);
  expect(await changePropertyType(db, change(), requestOf(editor))).toMatchObject({
    reason: 'not_permitted',
  });
}

async function provesReplay(db: Database, { editor }: Rig) {
  const row = await rowIn(db, editor, { collection: 'tprogram', jdArea: '60-69', title: 'Once' });
  const command = set(row, 'phase', 'running');
  const first = await setProperty(db, command, requestOf(editor));
  const later = new Date(collectionsAt.getTime() + 1000);
  expect(await setProperty(db, command, requestOf(editor, later))).toEqual(first);
  expect(first).toMatchObject({ status: 'accepted', version: 2 });
}

describe.skipIf(!testServer)('#206 relative values resolve on the server', () => {
  it('filters by me, today, a relative range and a nested or group', () =>
    withRig(provesRelativeValues));
});

describe.skipIf(!testServer)('#206 the query is intersected with the reader grants', () => {
  it('gives a reader without the area grant no rows', () => withRig(provesAreaGrant));
  it('withholds a narrower property everywhere, rollups included', () =>
    withRig(provesPropertyRule));
});

describe.skipIf(!testServer)('#206 money is read through', () => {
  it('reads not_wired, refuses a write and refuses a filter', () => withRig(provesReadThrough));
});

describe.skipIf(!testServer)('#206 grouping, sorting and computed values', () => {
  it('groups by status group, sorts by option order and counts days until a date', () =>
    withRig(provesGrouping));
});

describe.skipIf(!testServer)('#206 a type change is all or nothing', () => {
  it('lists the rows that do not fit, then converts when all fit', () => withRig(provesTypeChange));
  it('replays a command by its request id', () => withRig(provesReplay));
});
