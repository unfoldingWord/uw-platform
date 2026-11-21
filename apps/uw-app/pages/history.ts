import { and, desc, eq, sql } from 'drizzle-orm';
import { pageSchema, personStatusSchema, type Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageVersions, people } from '@uw/db/schema';
import type { PersonName } from '../people/directory.ts';
import { readPage } from './store.ts';

const HISTORY_LIMIT = 50;

export type PageVersion = {
  readonly version: number;
  readonly title: string;
  readonly savedAt: Date;
  readonly savedBy: string;
  readonly saver: PersonName | null;
};

type Saver = { readonly id: string; readonly name: string; readonly status: string } | null;

const saverColumns = { id: people.id, name: people.displayName, status: people.status };

function saverOf(saver: Saver): PersonName | null {
  if (saver === null) return null;
  return {
    personId: saver.id,
    displayName: saver.name,
    status: personStatusSchema.parse(saver.status),
  };
}

export async function pageHistory(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<readonly PageVersion[] | null> {
  if ((await readPage(db, actor, pageId, at)) === null) return null;
  const rows = await db
    .select({
      version: pageVersions.version,
      title: pageVersions.title,
      savedAt: pageVersions.savedAt,
      editSource: pageVersions.editSource,
      saver: saverColumns,
    })
    .from(pageVersions)
    .leftJoin(people, sql`${pageVersions.editSource} = 'human:' || ${people.id}::text`)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.version))
    .limit(HISTORY_LIMIT);
  return rows.map((row) => ({
    version: row.version,
    title: row.title,
    savedAt: row.savedAt,
    savedBy: row.saver?.name ?? row.editSource,
    saver: saverOf(row.saver),
  }));
}

export type PageSnapshot = {
  readonly page: Page;
  readonly savedAt: Date;
  readonly savedBy: string;
  readonly saver: PersonName | null;
};

export async function pageVersion(
  db: Executor,
  actor: Principal,
  key: { readonly pageId: string; readonly version: number },
  at: Date,
): Promise<PageSnapshot | null> {
  if ((await readPage(db, actor, key.pageId, at)) === null) return null;
  const [row] = await db
    .select({ snapshot: pageVersions, saver: saverColumns })
    .from(pageVersions)
    .leftJoin(people, sql`${pageVersions.editSource} = 'human:' || ${people.id}::text`)
    .where(and(eq(pageVersions.pageId, key.pageId), eq(pageVersions.version, key.version)));
  if (!row) return null;
  const { snapshot } = row;
  const page = pageSchema.parse({
    id: snapshot.pageId,
    type: snapshot.type,
    jdArea: snapshot.jdArea,
    slug: snapshot.slug,
    title: snapshot.title,
    parentId: snapshot.parentId,
    frontmatter: snapshot.frontmatter,
    bodyMd: snapshot.bodyMd,
    version: snapshot.version,
    status: snapshot.status,
  });
  return {
    page,
    savedAt: snapshot.savedAt,
    savedBy: row.saver?.name ?? snapshot.editSource,
    saver: saverOf(row.saver),
  };
}
