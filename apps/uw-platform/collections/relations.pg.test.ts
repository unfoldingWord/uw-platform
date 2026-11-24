import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collectionDefinitionSchema, type Principal, type SetPropertyCommand } from '@uw/contracts';
import type { Database } from '@uw/db/client';
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
import { setProperty } from './rows.ts';

const testLinks = collectionDefinitionSchema.parse({
  key: 'tlinks',
  name: 'Links',
  jdArea: '60-69',
  rowSource: 'pages',
  pageType: 'entry',
  properties: [
    {
      key: 'name',
      name: 'Name',
      config: { type: 'title' },
      source: { kind: 'column', column: 'title' },
    },
    {
      key: 'portfolios',
      name: 'Portfolios',
      source: { kind: 'derived' },
      config: { type: 'relation', relation: { target: 'tportfolio', multiple: true } },
    },
  ],
});

type Rig = {
  readonly db: Database;
  readonly editor: Principal;
  readonly wide: Principal;
  readonly far: Principal;
};

function withRig(work: (rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    await ensureBuiltIns(db, collectionsAt);
    const admin = await personWith(db, 'ana', [{ role: 'admin', area: '60-69' }]);
    const editor = await personWith(db, 'ed', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const wide = await personWith(db, 'wide', [
      { role: 'editor', area: '60-69' },
      { role: 'viewer', area: '70-79' },
      { role: 'viewer', area: '00-09' },
    ]);
    const far = await personWith(db, 'far', [
      { role: 'editor', area: '70-79' },
      { role: 'viewer', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    for (const definition of [testPortfolio, testProgram, testLinks]) {
      await defined(db, admin, definition);
    }
    await work({ db, editor, wide, far });
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

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item: { id: string }) => item.id).sort() : [];
}

async function provesManyKeepsUnseen({ db, editor, wide, far }: Rig) {
  const hidden = await rowIn(db, far, { collection: 'tportfolio', jdArea: '70-79', title: 'Far' });
  const near = await rowIn(db, editor, {
    collection: 'tportfolio',
    jdArea: '60-69',
    title: 'Near',
  });
  const other = await rowIn(db, editor, {
    collection: 'tportfolio',
    jdArea: '60-69',
    title: 'Other',
  });
  const row = await rowIn(db, editor, { collection: 'tlinks', jdArea: '60-69', title: 'Row' });
  accepted(
    await setProperty(db, set('tlinks', row, 'portfolios', [hidden, near]), requestOf(wide)),
  );
  accepted(await setProperty(db, set('tlinks', row, 'portfolios', [other]), requestOf(editor)));
  const read = await replyOf(db, wide, 'tlinks');
  expect(idsOf(read.rows[0]?.values['portfolios'])).toEqual([hidden, other].sort());
}

async function provesSingleRefusesUnseen({ db, editor, wide, far }: Rig) {
  const hidden = await rowIn(db, far, { collection: 'tportfolio', jdArea: '70-79', title: 'Far' });
  const near = await rowIn(db, editor, {
    collection: 'tportfolio',
    jdArea: '60-69',
    title: 'Near',
  });
  const row = await rowIn(db, editor, {
    collection: 'tprogram',
    jdArea: '60-69',
    title: 'Program',
  });
  accepted(await setProperty(db, set('tprogram', row, 'portfolio', hidden), requestOf(wide)));
  const refused = await setProperty(db, set('tprogram', row, 'portfolio', near), requestOf(editor));
  expect(refused).toMatchObject({ reason: 'not_permitted' });
}

async function provesReverseKeepsUnseen({ db, editor, far }: Rig) {
  const mine = await rowIn(db, editor, { collection: 'program', jdArea: '60-69', title: 'Mine' });
  const near = await rowIn(db, editor, { collection: 'project', jdArea: '60-69', title: 'Near' });
  const hidden = await rowIn(db, far, {
    collection: 'project',
    jdArea: '70-79',
    title: 'Far',
    values: { program: mine },
  });
  accepted(await setProperty(db, set('program', mine, 'projects', [near]), requestOf(editor)));
  const read = await replyOf(db, far, 'project');
  expect(idsOf(read.rows.find((r) => r.id === hidden)?.values['program'])).toEqual([mine]);
}

describe.skipIf(!testServer)('#206 a relation save keeps the links its editor cannot see', () => {
  it('keeps unseen targets of a many relation', () => withRig(provesManyKeepsUnseen));
  it('refuses replacing a single relation whose target the editor cannot read', () =>
    withRig(provesSingleRefusesUnseen));
  it('keeps unseen sources on the reverse side', () => withRig(provesReverseKeepsUnseen));
});
