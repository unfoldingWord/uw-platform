import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const drizzleKit = fileURLToPath(
  new URL('../../packages/db/node_modules/.bin/drizzle-kit', import.meta.url),
);

function sqlFiles(folder: string): string[] {
  return readdirSync(folder).filter((file) => file.endsWith('.sql'));
}

export function unmigratedChanges(schemaPath: string, migrationsPath: string): string[] {
  const scratch = mkdtempSync(join(tmpdir(), 'uw-db-drift-'));
  try {
    if (existsSync(migrationsPath)) cpSync(migrationsPath, scratch, { recursive: true });
    const before = sqlFiles(scratch);
    execFileSync(
      drizzleKit,
      ['generate', '--dialect', 'postgresql', '--schema', schemaPath, '--out', scratch],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return sqlFiles(scratch).filter((file) => !before.includes(file));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
