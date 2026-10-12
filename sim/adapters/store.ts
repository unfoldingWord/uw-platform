import type { EmbeddedDatabase } from '@uw/db/embedded';
import { createDrizzleStore } from '@uw/db/store';
import type { Store } from '@uw/harness';

export function createSimStore(database: EmbeddedDatabase): Store {
  return createDrizzleStore(database.db);
}
