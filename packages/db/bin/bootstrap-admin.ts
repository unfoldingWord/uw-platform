import postgres from 'postgres';
import { bootstrapAdmin } from '../bootstrap-admin.ts';

const target = process.env['DATABASE_URL'];
const email = process.env['BOOTSTRAP_ADMIN_EMAIL']?.trim() ?? '';
const named = process.env['BOOTSTRAP_ADMIN_NAME']?.trim() ?? '';

if (!target) {
  process.stderr.write('DATABASE_URL is not set: name the database to bootstrap.\n');
  process.exit(1);
}

if (email === '') {
  process.stdout.write('BOOTSTRAP_ADMIN_EMAIL is not set: no first admin added.\n');
  process.exit(0);
}

const connection = postgres(target, { max: 1, onnotice: () => undefined });
try {
  const displayName = named === '' ? (email.split('@')[0] ?? email) : named;
  await bootstrapAdmin((text, params) => connection.unsafe(text, [...params]), {
    email,
    displayName,
  });
} finally {
  await connection.end();
}
process.stdout.write('First admin checked.\n');
