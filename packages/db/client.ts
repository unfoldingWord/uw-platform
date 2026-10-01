import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export function createClient(hyperdriveConnectionString: string) {
  return drizzle(postgres(hyperdriveConnectionString, { max: 5, fetch_types: false }), { schema });
}

export type Database = ReturnType<typeof createClient>;
