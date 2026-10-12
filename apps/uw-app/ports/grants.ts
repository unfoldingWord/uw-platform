import type { Database } from '@uw/db/client';
import { createDrizzleGrants } from '@uw/db/store';
import type { Grants } from '@uw/harness';

export function platformGrants(db: Database): Grants {
  return createDrizzleGrants(db);
}
