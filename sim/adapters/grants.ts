import type { EmbeddedDatabase } from '@uw/db/embedded';
import { createDrizzleGrants } from '@uw/db/store';
import type { Grants } from '@uw/harness';

export function createSimGrants(database: EmbeddedDatabase): Grants {
  return createDrizzleGrants(database.db);
}
