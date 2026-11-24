import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const handlerRoots = ['apps/uw-platform/commands/handlers/', 'apps/uw-platform/commands/person/'];
const sourceFile = /\.tsx?$/;
const testFile = /\.test\.tsx?$/;
const databasePackage = /['"`]@uw\/db[/'"`]/;
const databaseMember = /\.\s*database\b|\{[^}]*\bdatabase\b[^}]*\}\s*=/;
const databaseKey = /['"`]database['"`]/;
const readRoutes = new Set([
  'apps/uw-platform/commands/person/gate-view.ts',
  'apps/uw-platform/commands/person/shadow-export.ts',
]);

type Read = (file: string) => string;
const readReal: Read = (file) => readFileSync(file, 'utf8');

function handlerFiles(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      handlerRoots.some((root) => file.startsWith(root)) &&
      sourceFile.test(file) &&
      !testFile.test(file) &&
      !readRoutes.has(file),
  );
}

function reachingTheDatabase(files: readonly string[], read: Read): string[] {
  return handlerFiles(files).filter((file) => {
    const text = read(file);
    return [databasePackage, databaseMember, databaseKey].some((pattern) => pattern.test(text));
  });
}

const planted: Readonly<Record<string, string>> = {
  'apps/uw-platform/commands/handlers/sneak-import.ts':
    "import { harnessEvents } from '@uw/db/schema';",
  'apps/uw-platform/commands/person/sneak-dynamic.ts': "const db = await import('@uw/db/client');",
  'apps/uw-platform/commands/handlers/sneak-handle.ts': 'await context.database.db.insert(row);',
  'apps/uw-platform/commands/person/sneak-destructure.ts': 'const { database } = context;',
  'apps/uw-platform/commands/person/sneak-get.ts': "const handle = c.get('database');",
  'apps/uw-platform/commands/handlers/sneak-index.ts': 'const handle = context["database"];',
  'apps/uw-platform/commands/handlers/sneak-template.ts': 'const handle = context[`database`];',
  'apps/uw-platform/commands/person/gate-view.ts': "const database = c.get('database');",
  'apps/uw-platform/commands/handlers/kept.ts': 'await context.pages.read(body.pageId);',
  'apps/uw-platform/commands/handlers/kept.test.ts': "import { seedPage } from '@uw/db/test-seed';",
  'apps/uw-platform/commands/dispatch.ts': "import type { Database } from '@uw/db/client';",
};

describe('the command handlers hold no database handle', () => {
  it('no handler file imports @uw/db or reads a database member', () => {
    const files = handlerFiles(repoFiles());
    expect(files).toContain('apps/uw-platform/commands/handlers/items.ts');
    expect(files).toContain('apps/uw-platform/commands/person/gates.ts');
    expect(reachingTheDatabase(files, readReal)).toEqual([]);
  });

  it('flags a planted handler that imports @uw/db or reaches for the database, and passes tests, the dispatcher and the gate view read route by name', () => {
    const read: Read = (file) => planted[file] ?? '';
    expect(reachingTheDatabase(Object.keys(planted), read)).toEqual([
      'apps/uw-platform/commands/handlers/sneak-import.ts',
      'apps/uw-platform/commands/person/sneak-dynamic.ts',
      'apps/uw-platform/commands/handlers/sneak-handle.ts',
      'apps/uw-platform/commands/person/sneak-destructure.ts',
      'apps/uw-platform/commands/person/sneak-get.ts',
      'apps/uw-platform/commands/handlers/sneak-index.ts',
      'apps/uw-platform/commands/handlers/sneak-template.ts',
    ]);
  });
});
