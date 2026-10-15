import { randomUUID } from 'node:crypto';
import type { Database } from '@uw/db/client';
import { seedPlatformPage } from '@uw/db/test-seed';

export async function listForDispatch(
  db: Database,
  repository: string | null,
  jdArea = '80-89',
): Promise<void> {
  if (repository === null) return;
  await seedPlatformPage(db, { id: randomUUID(), jdArea, repositories: [repository] });
}
