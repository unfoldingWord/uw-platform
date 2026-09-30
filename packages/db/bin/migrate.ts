import { applyMigrations } from '../migrate.ts';

const target = process.env['DATABASE_URL'];

if (!target) {
  process.stderr.write('DATABASE_URL is not set: name the database to migrate.\n');
  process.exit(1);
}

await applyMigrations(target);
process.stdout.write('Migrations applied.\n');
