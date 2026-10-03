import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const handlerRoots = ['apps/uw-app/commands/handlers/', 'apps/uw-app/commands/person/'];
const sourceFile = /\.tsx?$/;
const testFile = /\.test\.tsx?$/;
const databasePackage = /['"`]@uw\/db[/'"`]/;
const databaseMember = /\.\s*database\b|\{[^}]*\bdatabase\b[^}]*\}\s*=/;

type Read = (file: string) => string;
const readReal: Read = (file) => readFileSync(file, 'utf8');

function handlerFiles(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      handlerRoots.some((root) => file.startsWith(root)) &&
      sourceFile.test(file) &&
      !testFile.test(file),
  );
}

function reachingTheDatabase(files: readonly string[], read: Read): string[] {
  return handlerFiles(files).filter((file) => {
    const text = read(file);
    return databasePackage.test(text) || databaseMember.test(text);
  });
}

const planted: Readonly<Record<string, string>> = {
  'apps/uw-app/commands/handlers/sneak-import.ts': "import { harnessEvents } from '@uw/db/schema';",
  'apps/uw-app/commands/person/sneak-dynamic.ts': "const db = await import('@uw/db/client');",
  'apps/uw-app/commands/handlers/sneak-handle.ts': 'await context.database.db.insert(row);',
  'apps/uw-app/commands/person/sneak-destructure.ts': 'const { database } = context;',
  'apps/uw-app/commands/handlers/kept.ts': 'await context.pages.read(body.pageId);',
  'apps/uw-app/commands/handlers/kept.test.ts': "import { seedPage } from '@uw/db/test-seed';",
  'apps/uw-app/commands/dispatch.ts': "import type { Database } from '@uw/db/client';",
};

describe('the command handlers hold no database handle', () => {
  it('no handler file imports @uw/db or reads a database member', () => {
    const files = handlerFiles(repoFiles());
    expect(files).toContain('apps/uw-app/commands/handlers/items.ts');
    expect(files).toContain('apps/uw-app/commands/person/gates.ts');
    expect(reachingTheDatabase(files, readReal)).toEqual([]);
  });

  it('flags a planted handler that imports @uw/db or reaches for the database, and passes tests and the dispatcher', () => {
    const read: Read = (file) => planted[file] ?? '';
    expect(reachingTheDatabase(Object.keys(planted), read)).toEqual([
      'apps/uw-app/commands/handlers/sneak-import.ts',
      'apps/uw-app/commands/person/sneak-dynamic.ts',
      'apps/uw-app/commands/handlers/sneak-handle.ts',
      'apps/uw-app/commands/person/sneak-destructure.ts',
    ]);
  });
});
