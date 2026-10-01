import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

export const testServer = process.env['TEST_DATABASE_URL'];

type Admin = ReturnType<typeof postgres>;

async function withAdmin<T>(server: string, work: (admin: Admin) => Promise<T>): Promise<T> {
  const admin = postgres(server, { max: 1, onnotice: () => undefined });
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
}

export async function withEmptyDatabase<T>(
  server: string,
  work: (connectionString: string) => Promise<T>,
): Promise<T> {
  const name = `uw_test_${randomBytes(6).toString('hex')}`;
  const target = new URL(server);
  target.pathname = `/${name}`;
  await withAdmin(server, (admin) => admin.unsafe(`CREATE DATABASE "${name}"`));
  try {
    return await work(target.toString());
  } finally {
    await withAdmin(server, (admin) => admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`));
  }
}

export async function query<T extends Record<string, unknown>>(
  connectionString: string,
  text: string,
): Promise<T[]> {
  return withAdmin(connectionString, async (connection) => [
    ...(await connection.unsafe<T[]>(text)),
  ]);
}
