import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema.ts';

export type AnyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
