import { sql } from 'drizzle-orm';
import type { Page, PageEntry } from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';

export type Ancestor = { readonly id: string; readonly title: string };
export type TreeNode = { readonly page: PageEntry; readonly children: readonly TreeNode[] };

const DEEPEST = 20;

export async function ancestorsOf(
  db: Executor,
  actor: Principal,
  page: Pick<Page, 'parentId'>,
  at: Date,
): Promise<readonly Ancestor[]> {
  if (page.parentId === null) return [];
  const rows = await db.execute<{ id: string; title: string; jd_area: string; depth: number }>(sql`
    WITH RECURSIVE chain(id, title, jd_area, parent_id, depth) AS (
      SELECT id, title, jd_area, parent_id, 1 FROM pages WHERE id = ${page.parentId}
      UNION ALL
      SELECT p.id, p.title, p.jd_area, p.parent_id, c.depth + 1
      FROM pages p JOIN chain c ON p.id = c.parent_id WHERE c.depth < ${DEEPEST}
    )
    SELECT id, title, jd_area, depth FROM chain ORDER BY depth DESC`);
  const readable = readableAreas(actor, at);
  const mayRead = (area: string) => readable.kind === 'all' || readable.areas.includes(area);
  return [...rows].filter((row) => mayRead(row.jd_area)).map(({ id, title }) => ({ id, title }));
}

export function treeOf(entries: readonly PageEntry[]): readonly TreeNode[] {
  const known = new Set(entries.map((entry) => entry.id));
  const under = new Map<string | null, PageEntry[]>();
  for (const entry of entries) {
    const parent = entry.parentId !== null && known.has(entry.parentId) ? entry.parentId : null;
    under.set(parent, [...(under.get(parent) ?? []), entry]);
  }
  const grow = (parent: string | null, depth: number): readonly TreeNode[] =>
    depth > DEEPEST
      ? []
      : (under.get(parent) ?? []).map((page) => ({ page, children: grow(page.id, depth + 1) }));
  return grow(null, 0);
}
