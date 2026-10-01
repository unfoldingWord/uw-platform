import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

export async function applyMigrations(
  directConnectionString: string,
  folder: string = migrationsFolder,
): Promise<void> {
  const connection = postgres(directConnectionString, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(connection), { migrationsFolder: folder });
  } finally {
    await connection.end();
  }
}
