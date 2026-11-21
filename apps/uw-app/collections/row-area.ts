import { eq } from 'drizzle-orm';
import type { JdArea } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages, tasks } from '@uw/db/schema';
import type { StoredCollection } from './definitions.ts';

export async function areaOfRow(
  db: Executor,
  stored: StoredCollection,
  rowId: string,
): Promise<JdArea | null> {
  const source = stored.definition.rowSource;
  if (source === 'people') return stored.definition.jdArea;
  if (source === 'tasks') {
    const [task] = await db.select({ area: tasks.jdArea }).from(tasks).where(eq(tasks.id, rowId));
    return task?.area ?? null;
  }
  const [page] = await db
    .select({ area: pages.jdArea, collectionId: pages.collectionId })
    .from(pages)
    .where(eq(pages.id, rowId));
  return page?.collectionId === stored.id ? page.area : null;
}
