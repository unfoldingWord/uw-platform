import { readFileSync } from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { grantAudit, roleGrants } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const migration = new URL('./migrations/0049_categories_and_default_reading.sql', import.meta.url);
const backfill = readFileSync(migration, 'utf8').split('--> statement-breakpoint').at(-1) ?? '';

const staff = '00000000-0000-4000-8000-0000000000d1';
const orgReader = '00000000-0000-4000-8000-0000000000d2';
const waiting = '00000000-0000-4000-8000-0000000000d3';
const homeEditor = '00000000-0000-4000-8000-0000000000d4';

async function person(db: Db, id: string, status: string): Promise<void> {
  await db.execute(sql`INSERT INTO people (id, email, display_name, status)
    VALUES (${id}, ${`${id}@unfoldingword.org`}, 'Someone', ${status})`);
}

async function grant(db: Db, id: string, role: string, area: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO role_grants (person_id, role, scope_kind, scope_area)
    VALUES (${id}, ${role}, ${area === null ? 'org' : 'jd_area'}, ${area})`);
}

async function grantsOf(db: Db, id: string): Promise<string[]> {
  const rows = await db
    .select({ role: roleGrants.role, area: roleGrants.scopeArea })
    .from(roleGrants)
    .where(and(eq(roleGrants.personId, id), isNull(roleGrants.revokedAt)));
  return rows.map((row) => `${row.role} ${row.area ?? 'org'}`).sort();
}

async function defaultsAudited(db: Db): Promise<number> {
  const rows = await db
    .select({ id: grantAudit.id })
    .from(grantAudit)
    .where(and(eq(grantAudit.action, 'default'), eq(grantAudit.actor, `human:${staff}`)));
  return rows.length;
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | null = null;
  beforeAll(async () => {
    opened = await target.open();
  });
  afterAll(async () => {
    await opened?.close();
  });
  return () => {
    if (opened === null) throw new Error('the database did not open');
    return opened.db;
  };
}

describe.each(databaseTargets)('#175 the default reading backfill on $name', (target) => {
  const db = openDatabase(target);

  it('gives viewer on 00-09 to active people who could not read it, and to nobody else', async () => {
    await person(db(), staff, 'active');
    await person(db(), orgReader, 'active');
    await person(db(), waiting, 'pending');
    await person(db(), homeEditor, 'active');
    await grant(db(), orgReader, 'viewer', null);
    await grant(db(), homeEditor, 'editor', '00-09');
    await db().execute(sql.raw(backfill));
    expect(await grantsOf(db(), staff)).toEqual(['viewer 00-09']);
    expect(await grantsOf(db(), orgReader)).toEqual(['viewer org']);
    expect(await grantsOf(db(), waiting)).toEqual([]);
    expect(await grantsOf(db(), homeEditor)).toEqual(['editor 00-09']);
    expect(await defaultsAudited(db())).toBe(1);
    await db().execute(sql.raw(backfill));
    expect(await grantsOf(db(), staff)).toEqual(['viewer 00-09']);
  });
});
