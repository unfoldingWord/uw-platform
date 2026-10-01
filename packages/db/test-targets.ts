import type { AnyDatabase } from './any-database.ts';
import { createClient } from './client.ts';
import { createEmbeddedDatabase } from './embedded.ts';
import { createMigratedDatabase, testServer } from './test-database.ts';

export type OpenedDatabase = { readonly db: AnyDatabase; close(): Promise<void> };
export type DatabaseTarget = {
  readonly name: 'embedded' | 'server';
  open(): Promise<OpenedDatabase>;
};

const embedded: DatabaseTarget = { name: 'embedded', open: createEmbeddedDatabase };

function serverTarget(server: string): DatabaseTarget {
  return {
    name: 'server',
    open: async () => {
      const database = await createMigratedDatabase(server);
      const db = createClient(database.connectionString);
      return {
        db,
        close: async () => {
          await db.$client.end();
          await database.drop();
        },
      };
    },
  };
}

export const databaseTargets: readonly DatabaseTarget[] = testServer
  ? [embedded, serverTarget(testServer)]
  : [embedded];
