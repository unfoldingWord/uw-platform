import type { Database } from '@uw/db/client';
import type { Clock, PageAppends } from '@uw/harness';
import { appendToPage } from '../pages/append.ts';

export function platformPageAppends(db: Database, clock: Clock): PageAppends {
  return {
    append: (actor, change) => appendToPage(db, actor, { ...change, at: clock.now() }),
  };
}
