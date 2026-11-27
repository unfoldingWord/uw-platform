import { sql } from 'drizzle-orm';
import type { ErrorReason, UpdatePageCommand } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Transaction } from '@uw/db/client';
import { readPage } from './page-row.ts';

async function ancestorChainReaches(
  tx: Transaction,
  parentId: string,
  pageId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    WITH RECURSIVE chain(id, parent_id) AS (
      SELECT id, parent_id FROM pages WHERE id = ${parentId}
      UNION
      SELECT p.id, p.parent_id FROM pages p JOIN chain c ON p.id = c.parent_id
    )
    SELECT 1 FROM chain WHERE id = ${pageId} LIMIT 1`);
  return rows.length > 0;
}

export async function parentRefusal(
  tx: Transaction,
  actor: Principal,
  command: Pick<UpdatePageCommand, 'pageId' | 'parentId'>,
  at: Date,
): Promise<ErrorReason | null> {
  if (command.parentId === null) return null;
  if (command.parentId === command.pageId) return 'parent_cycle';
  if ((await readPage(tx, actor, command.parentId, at)) === null) return 'parent_not_found';
  if (await ancestorChainReaches(tx, command.parentId, command.pageId)) return 'parent_cycle';
  return null;
}
