import { desc, eq, sql } from 'drizzle-orm';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageVersions, people } from '@uw/db/schema';
import { readPage } from './store.ts';

export const HISTORY_LIMIT = 50;

export type PageVersion = {
  readonly version: number;
  readonly title: string;
  readonly savedAt: Date;
  readonly savedBy: string;
};

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
      name: people.displayName,
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
    savedBy: row.name ?? row.editSource,
  }));
}
