import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type QueryListener = (query: string, parameters: readonly unknown[]) => void;

export function createClient(hyperdriveConnectionString: string, onQuery?: QueryListener) {
  const debug =
    onQuery === undefined
      ? false
      : (_connection: number, query: string, parameters: unknown[]) => onQuery(query, parameters);
  return drizzle(postgres(hyperdriveConnectionString, { max: 5, fetch_types: false, debug }), {
    schema,
  });
}

export type Database = ReturnType<typeof createClient>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;
