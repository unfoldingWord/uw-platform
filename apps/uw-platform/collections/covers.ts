import { inArray } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';

const firstImage = /!\[[^\]\n]{0,200}\]\(([^)\s]{1,500})\)/;

function coverOf(bodyMd: string): string | null {
  const url = firstImage.exec(bodyMd)?.[1] ?? null;
  if (url === null) return null;
  return url.startsWith('/api/files/') || url.startsWith('https://') ? url : null;
}

export async function coversOf(
  db: Executor,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: pages.id, bodyMd: pages.bodyMd })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
  return new Map(
    rows.flatMap((row) => {
      const cover = coverOf(row.bodyMd);
      return cover === null ? [] : [[row.id, cover] as const];
    }),
  );
}
