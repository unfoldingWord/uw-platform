import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from './migrate.ts';
import * as schema from './schema.ts';

export type EmbeddedDatabase = {
  readonly db: PgliteDatabase<typeof schema>;
  close(): Promise<void>;
};

let template: Promise<PGlite> | null = null;

async function migratedTemplate(): Promise<PGlite> {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder });
  return client;
}

export async function createEmbeddedDatabase(): Promise<EmbeddedDatabase> {
  template ??= migratedTemplate();
  const client = await (await template).clone();
  if (!(client instanceof PGlite)) throw new Error('PGlite cloned something that is not PGlite');
  return { db: drizzle(client, { schema }), close: () => client.close() };
}

export async function closeEmbeddedTemplate(): Promise<void> {
  const pending = template;
  template = null;
  if (pending) await (await pending).close();
}
