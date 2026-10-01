import type { Database } from '@uw/db/client';
import { createDrizzleStore } from '@uw/db/store';
import type { Store } from '@uw/harness';

export function platformStore(db: Database): Store {
  return createDrizzleStore(db);
}
