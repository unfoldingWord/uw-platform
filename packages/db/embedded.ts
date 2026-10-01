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

async function migratedTemplate(folder: string): Promise<PGlite> {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } catch (error) {
    await client.close();
    throw error;
  }
  return client;
}

async function cloneOf(source: PGlite): Promise<PGlite> {
  const client = await source.clone();
  if (client instanceof PGlite) return client;
  await client.close();
  throw new Error('PGlite cloned something that is not PGlite');
}

async function builtTemplate(folder: string): Promise<PGlite> {
  const pending = migratedTemplate(folder);
  template = pending;
  try {
    return await pending;
  } catch (error) {
    if (template === pending) template = null;
    throw error;
  }
}

export async function createEmbeddedDatabase(
  folder: string = migrationsFolder,
): Promise<EmbeddedDatabase> {
  const client = await cloneOf(await (template ?? builtTemplate(folder)));
  return { db: drizzle(client, { schema }), close: () => client.close() };
}

export async function closeEmbeddedTemplate(): Promise<void> {
  const pending = template;
  template = null;
  if (!pending) return;
  const client = await pending.catch(() => null);
  await client?.close();
}
