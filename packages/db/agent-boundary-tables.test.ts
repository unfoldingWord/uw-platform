import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const atText = '2026-10-01T09:00:00.000Z';
const person = '00000000-0000-4000-8000-000000000001';
const trace = '00000000-0000-4000-8000-0000000000e1';
const agent = 'agent:00000000-0000-4000-8000-000000000001/laptop';

type TaskRow = { title: string; area: string; status: string; createdBy: string; page: string };
type TokenRow = { device: string; boundBy: string; revokedAt: string | null };

const validTask: TaskRow = {
  title: 'Draft the plan',
  area: '80-89',
  status: 'suggested',
  createdBy: agent,
  page: '',
};
const validToken: TokenRow = { device: 'laptop', boundBy: 'human:ian', revokedAt: null };

function idOf(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function insertTask(db: Db, id: string, change: Partial<TaskRow> = {}) {
  const row = { ...validTask, ...change };
  return db.execute(sql`INSERT INTO tasks
      (id, jd_area, title, page_id, status, created_by, trace_id, created_at)
    VALUES (${id}, ${row.area}, ${row.title}, ${row.page === '' ? null : row.page}::uuid,
      ${row.status}, ${row.createdBy}, ${trace}, ${atText}::timestamptz)`);
}

function insertToken(db: Db, clientId: string, change: Partial<TokenRow> = {}) {
  const row = { ...validToken, ...change };
  return db.execute(sql`INSERT INTO service_tokens
      (client_id, person_id, device, bound_by, bound_at, revoked_at, trace_id)
    VALUES (${clientId}, ${person}, ${row.device}, ${row.boundBy}, ${atText}::timestamptz,
      ${row.revokedAt}::timestamptz, ${trace})`);
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  const db = () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());
  return db;
}

const taskRefusals: [string, Partial<TaskRow>, string, string][] = [
  ['an unknown status', { status: 'bogus' }, '23514', 'tasks_status_known'],
  ['an area that is not one JD area', { area: '8-89' }, '23514', 'tasks_area_form'],
  [
    'a creator that is no identity',
    { createdBy: 'someone' },
    '23514',
    'tasks_created_by_is_identity',
  ],
  ['a blank title', { title: '   ' }, '23514', 'tasks_title_not_blank'],
  ['a page that does not exist', { page: idOf(0x9f) }, '23503', 'tasks_page_id_pages_id_fk'],
];

function taskRules(db: () => Db): void {
  it('declares tasks internal and synced', () => {
    expect(declarationOf(schema.tasks)).toEqual({
      classification: 'internal',
      offlineEligibility: 'sync',
    });
  });

  it('accepts a suggested task in 80-89 created by an agent identity', async () => {
    await insertTask(db(), idOf(0x71));
    const rows = await db()
      .select({ status: schema.tasks.status })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, idOf(0x71)));
    expect(rows).toEqual([{ status: 'suggested' }]);
  });

  it.each(taskRefusals)('refuses %s', async (_label, change, code, constraint) => {
    expect(await refusal(insertTask(db(), idOf(0x72), change))).toEqual({ code, constraint });
  });
}

function tokenRules(db: () => Db): void {
  it('declares service_tokens restricted and never offline', () => {
    expect(declarationOf(schema.serviceTokens)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
  });

  it('binds a client id, and refuses a second binding of the same client id', async () => {
    await insertToken(db(), 'client-a');
    expect(await refusal(insertToken(db(), 'client-a', { device: 'desktop' }))).toEqual({
      code: '23505',
      constraint: 'service_tokens_pkey',
    });
  });

  it('refuses a device that is not lowercase kebab-case', async () => {
    expect(await refusal(insertToken(db(), 'client-b', { device: 'Laptop' }))).toEqual({
      code: '23514',
      constraint: 'service_tokens_device_form',
    });
  });

  it('refuses a binder that is not a person', async () => {
    expect(await refusal(insertToken(db(), 'client-c', { boundBy: 'agent:x' }))).toEqual({
      code: '23514',
      constraint: 'service_tokens_bound_by_is_human',
    });
  });

  it('refuses two live bindings of one device, and allows one after a revoke', async () => {
    await insertToken(db(), 'client-d', { device: 'phone' });
    expect(await refusal(insertToken(db(), 'client-e', { device: 'phone' }))).toEqual({
      code: '23505',
      constraint: 'service_tokens_one_live_device',
    });
    await db().execute(
      sql`UPDATE service_tokens SET revoked_at = ${atText}::timestamptz WHERE client_id = 'client-d'`,
    );
    await insertToken(db(), 'client-e', { device: 'phone' });
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  describe('tasks hold a suggested task in an area, attributed to an identity', () =>
    taskRules(db));
  describe("service_tokens bind one client id to one person's device", () => tokenRules(db));
}

describe('the agent boundary tables', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
