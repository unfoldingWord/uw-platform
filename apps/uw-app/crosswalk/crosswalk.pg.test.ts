import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cascadeNodeReplySchema, crosswalkReplySchema, type CrosswalkReply } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { jdCascadeMapAudit, tasks } from '@uw/db/schema';
import { seedGrant, seedHarness, seedItem, seedPage, seedPerson } from '@uw/db/test-seed';
import { get, person, post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const COMMANDS = '/api/crosswalk/commands';

type World = {
  readonly admin: string;
  readonly finance: string;
  readonly home: string;
  readonly portfolio: string;
  readonly program: string;
  readonly project: string;
  readonly financePage: string;
  readonly unplacedPage: string;
  readonly task: string;
  readonly item: string;
};

async function grant(
  db: Database,
  personId: string,
  role: 'admin' | 'viewer',
  area: string | null,
) {
  await seedGrant(db, {
    id: randomUUID(),
    personId,
    role,
    scopeKind: area === null ? 'org' : 'jd_area',
    scopeArea: area,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
}

async function orgAdmin(db: Database): Promise<string> {
  const id = randomUUID();
  const email = 'crosswalk-org-admin@unfoldingword.org';
  await seedPerson(db, { id, email });
  await grant(db, id, 'admin', null);
  return email;
}

async function page(
  db: Database,
  type: 'knowledge' | 'portfolio' | 'program' | 'project',
  jdArea: string,
  title: string,
) {
  const id = randomUUID();
  const slug = `${type}-${id.slice(0, 8)}`;
  await seedPage(db, { id, type, status: 'active', jdArea, bodyMd: '', slug, title });
  return id;
}

async function seedTask(db: Database, jdArea: string): Promise<string> {
  const id = randomUUID();
  await db.insert(tasks).values({
    id,
    jdArea,
    title: 'Reconcile the month',
    status: 'open',
    createdBy: 'human:00000000-0000-4000-8000-000000000001',
    traceId: randomUUID(),
    createdAt: new Date(),
  });
  return id;
}

async function seedWorld(db: Database): Promise<World> {
  const admin = await orgAdmin(db);
  const financePerson = await person(db, 'crosswalk-finance', 'editor', '20-29');
  await grant(db, financePerson.id, 'viewer', '00-09');
  const finance = financePerson.email;
  const home = (await person(db, 'crosswalk-home', 'viewer', '00-09')).email;
  const portfolio = await page(db, 'portfolio', '00-09', 'Church-Centric Bible Translation');
  const program = await page(db, 'program', '00-09', 'Field Partnerships');
  const project = await page(db, 'project', '00-09', 'Partner Workshop');
  const financePage = await page(db, 'knowledge', '20-29', '21.10 Rolling Budget');
  const unplacedPage = await page(db, 'knowledge', '20-29', '22.11 Statements');
  const task = await seedTask(db, '20-29');
  const harnessId = randomUUID();
  await seedHarness(db, { id: harnessId, key: 'crosswalk-tech', jdArea: '80-89' });
  const item = randomUUID();
  await seedItem(db, { id: item, harnessId, stageId: randomUUID() });
  return {
    admin,
    finance,
    home,
    portfolio,
    program,
    project,
    financePage,
    unplacedPage,
    task,
    item,
  };
}

function declare(jdArea: string, cascadePageId: string, relation: string) {
  return {
    command: 'declare_jd_map',
    requestId: randomUUID(),
    jdArea,
    cascadePageId,
    relation,
    note: null,
  };
}

function place(entityKind: string, entityId: string, cascadePageId: string | null) {
  return {
    command: 'place_in_cascade',
    requestId: randomUUID(),
    entityKind,
    entityId,
    cascadePageId,
  };
}

async function accepted(db: Database, email: string, name: string, body: unknown): Promise<void> {
  const sent = await post(db, email, `${COMMANDS}/${name}`, body);
  expect(sent.body).toMatchObject({ status: 'accepted' });
}

async function mapAndPlace(db: Database, made: World): Promise<void> {
  await accepted(db, made.admin, 'declare_jd_map', declare('20-29', made.portfolio, 'supports'));
  await accepted(db, made.admin, 'declare_jd_map', declare('80-89', made.program, 'owns'));
  await accepted(
    db,
    made.finance,
    'place_in_cascade',
    place('page', made.financePage, made.program),
  );
  await accepted(db, made.finance, 'place_in_cascade', place('task', made.task, made.project));
  await accepted(db, made.admin, 'place_in_cascade', place('item', made.item, made.program));
}

async function read(db: Database, email: string): Promise<CrosswalkReply> {
  return crosswalkReplySchema.parse((await get(db, { email }, '/api/crosswalk')).body);
}

function cell(reply: CrosswalkReply, area: string, tier: string) {
  const row = reply.rows.find((entry) => entry.jdArea === area);
  return row?.cells.find((entry) => entry.tier === tier);
}

async function countsBothWays(db: Database): Promise<void> {
  const made = await seedWorld(db);
  await mapAndPlace(db, made);
  const all = await read(db, made.admin);
  expect(all.tiers).toEqual(['portfolio', 'program', 'project']);
  expect(cell(all, '20-29', 'program')?.counts).toEqual({ pages: 1, tasks: 0, items: 0 });
  expect(cell(all, '20-29', 'project')?.counts).toEqual({ pages: 0, tasks: 1, items: 0 });
  expect(cell(all, '20-29', 'portfolio')?.links.map((link) => [link.relation, link.title])).toEqual(
    [['supports', 'Church-Centric Bible Translation']],
  );
  expect(all.rows.find((row) => row.jdArea === '20-29')?.unplaced).toEqual({
    pages: 1,
    tasks: 0,
    items: 0,
  });
  expect(cell(all, '80-89', 'program')?.counts).toEqual({ pages: 0, tasks: 0, items: 1 });
  expect(cell(all, '00-09', 'portfolio')?.counts.pages).toBe(1);
  const node = await get(db, { email: made.admin }, `/api/crosswalk/nodes/${made.program}`);
  const byNode = cascadeNodeReplySchema.parse(node.body);
  expect(byNode.tier).toBe('program');
  expect(
    byNode.areas.map((area) => [area.jdArea, area.counts, area.links.map((l) => l.relation)]),
  ).toEqual([
    ['00-09', { pages: 1, tasks: 0, items: 0 }, []],
    ['20-29', { pages: 1, tasks: 0, items: 0 }, []],
    ['80-89', { pages: 0, tasks: 0, items: 1 }, ['owns']],
  ]);
}

async function noCountsWithoutAGrant(db: Database): Promise<void> {
  const made = await seedWorld(db);
  await mapAndPlace(db, made);
  const finance = await read(db, made.finance);
  expect(finance.rows.map((row) => row.jdArea)).toEqual(['00-09', '20-29']);
  const home = await read(db, made.home);
  expect(home.rows.map((row) => row.jdArea)).toEqual(['00-09']);
  expect(home.rows[0]?.cells.flatMap((entry) => entry.links)).toEqual([]);
  const node = await get(db, { email: made.home }, `/api/crosswalk/nodes/${made.program}`);
  expect(cascadeNodeReplySchema.parse(node.body).areas.map((area) => area.jdArea)).toEqual([
    '00-09',
  ]);
}

async function onlyAnOrgAdminWritesTheMap(db: Database): Promise<void> {
  const made = await seedWorld(db);
  const areaAdmin = (await person(db, 'crosswalk-area-admin', 'admin', '20-29')).email;
  const refused = await post(
    db,
    areaAdmin,
    `${COMMANDS}/declare_jd_map`,
    declare('20-29', made.portfolio, 'funds'),
  );
  expect(refused.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const notANode = await post(
    db,
    made.admin,
    `${COMMANDS}/declare_jd_map`,
    declare('20-29', made.financePage, 'funds'),
  );
  expect(notANode.body).toMatchObject({ status: 'error', reason: 'cascade_node_not_found' });
  await accepted(db, made.admin, 'declare_jd_map', declare('20-29', made.portfolio, 'funds'));
  const [link] = cell(await read(db, made.admin), '20-29', 'portfolio')?.links ?? [];
  expect(link?.relation).toBe('funds');
  const remove = { command: 'remove_jd_map', requestId: randomUUID(), mapId: link?.mapId };
  await accepted(db, made.admin, 'remove_jd_map', remove);
  const again = await post(db, made.admin, `${COMMANDS}/remove_jd_map`, {
    ...remove,
    requestId: randomUUID(),
  });
  expect(again.body).toMatchObject({ status: 'error', reason: 'map_not_found' });
  const audit = await db.select().from(jdCascadeMapAudit);
  expect(audit.map((row) => [row.action, row.mapId, row.actor.startsWith('human:')])).toEqual([
    ['declare', link?.mapId, true],
    ['remove', link?.mapId, true],
  ]);
}

async function placingNeedsWriteOnTheEntitysArea(db: Database): Promise<void> {
  const made = await seedWorld(db);
  const viewer = await post(
    db,
    made.home,
    `${COMMANDS}/place_in_cascade`,
    place('page', made.portfolio, made.program),
  );
  expect(viewer.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const unseen = await post(
    db,
    made.home,
    `${COMMANDS}/place_in_cascade`,
    place('task', made.task, made.program),
  );
  expect(unseen.body).toMatchObject({ status: 'error', reason: 'row_not_found' });
  const node = await post(
    db,
    made.admin,
    `${COMMANDS}/place_in_cascade`,
    place('page', made.program, made.portfolio),
  );
  expect(node.body).toMatchObject({ status: 'error', reason: 'invalid_value' });
  const nowhere = await post(
    db,
    made.finance,
    `${COMMANDS}/place_in_cascade`,
    place('page', made.financePage, made.unplacedPage),
  );
  expect(nowhere.body).toMatchObject({ status: 'error', reason: 'cascade_node_not_found' });
  await accepted(
    db,
    made.finance,
    'place_in_cascade',
    place('page', made.financePage, made.program),
  );
  await accepted(db, made.finance, 'place_in_cascade', place('page', made.financePage, null));
  expect(cell(await read(db, made.finance), '20-29', 'program')?.counts.pages).toBe(0);
}

describe.skipIf(!testServer)('#202 the JD map and the crosswalk', () => {
  it('counts pages, tasks and items by area and tier, and the same placements by cascade node', () =>
    withAppDatabase(countsBothWays));

  it('shows a reader no counts and no map relations from an area they hold no grant on', () =>
    withAppDatabase(noCountsWithoutAGrant));

  it('takes a map relation only from an org admin, only to a cascade node, and audits it', () =>
    withAppDatabase(onlyAnOrgAdminWritesTheMap));

  it('places an entity only for a writer of its area, never a node, and only under a node', () =>
    withAppDatabase(placingNeedsWriteOnTheEntitysArea));
});
