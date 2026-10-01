import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { owns as acl } from '../../apps/uw-app/acl/grant-commands.ts';
import { owns as pages } from '../../apps/uw-app/pages/store.ts';
import { owns as people } from '../../apps/uw-app/people/directory.ts';
import { owns as queue } from '../../apps/uw-app/queue/watermarks.ts';
import { owns as deliveries } from '../../apps/uw-ingest/deliveries/ledger.ts';
import { tableEntries } from '../../packages/db/declarations.ts';
import * as schema from '../../packages/db/schema.ts';

type Owner = { dir: string; tables: readonly string[] };
type Entry = { exportName: string; table: string };

const owners: Owner[] = [
  { dir: 'apps/uw-app/people/', tables: people },
  { dir: 'apps/uw-app/acl/', tables: acl },
  { dir: 'apps/uw-app/pages/', tables: pages },
  { dir: 'apps/uw-app/queue/', tables: queue },
  { dir: 'apps/uw-ingest/deliveries/', tables: deliveries },
];

const entries = tableEntries(schema);

function sourcesUnder(base: string, roots: string[]): string[] {
  return roots.flatMap((root) =>
    readdirSync(join(base, root), { recursive: true, encoding: 'utf8' })
      .filter(
        (file) =>
          /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes('node_modules'),
      )
      .map((file) => join(root, file)),
  );
}

function writes(source: string, entry: Entry): boolean {
  return [
    new RegExp(`\\.(insert|update|delete)\\(\\s*(?:\\w+\\.)?${entry.exportName}\\b`),
    new RegExp(`\\b(INSERT INTO|UPDATE|DELETE FROM)\\s+"?${entry.table}"?\\b`, 'i'),
  ].some((pattern) => pattern.test(source));
}

function writersOutsideOwner(
  base: string,
  sources: string[],
  entry: Entry,
  ownerList: Owner[],
): string[] {
  const owner = ownerList.find((candidate) => candidate.tables.includes(entry.table));
  return sources
    .filter((file) => !file.startsWith(owner?.dir ?? '\0'))
    .filter((file) => writes(readFileSync(join(base, file), 'utf8'), entry));
}

function claimProblems(ownerList: Owner[], tableNames: string[]): string[] {
  const claimed = ownerList.flatMap((owner) => owner.tables);
  const twice = claimed.filter((table, index) => claimed.indexOf(table) !== index);
  const unclaimed = tableNames.filter((table) => !claimed.includes(table));
  const unknown = claimed.filter((table) => !tableNames.includes(table));
  return [
    ...twice.map((table) => `${table} is claimed twice`),
    ...unclaimed.map((table) => `${table} is claimed by no module`),
    ...unknown.map((table) => `${table} is claimed but is not a table`),
  ];
}

function exportingOwns(base: string, sources: string[]): string[] {
  return sources
    .filter((file) => /export const owns\b/.test(readFileSync(join(base, file), 'utf8')))
    .map((file) => `${dirname(file)}/`);
}

const UNSCANNED_PACKAGE = 'db';

function packageRoots(base: string): string[] {
  if (!existsSync(join(base, 'packages'))) return [];
  return readdirSync(join(base, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== UNSCANNED_PACKAGE)
    .map((entry) => `packages/${entry.name}`)
    .sort();
}

function scanRoots(base: string): string[] {
  return ['apps/uw-app', 'apps/uw-ingest', ...packageRoots(base), 'sim'].filter((root) =>
    existsSync(join(base, root)),
  );
}

const repoRoot = join(import.meta.dirname, '..', '..');
const sources = sourcesUnder(repoRoot, scanRoots(repoRoot));

describe('AGENTS.md rule 3: every table has one writer', () => {
  it('has every schema table owned by exactly one module', () => {
    expect(
      claimProblems(
        owners,
        entries.map((entry) => entry.table),
      ),
    ).toEqual([]);
  });

  it('finds every module that exports owns', () => {
    expect(exportingOwns(repoRoot, sources).sort()).toEqual(
      owners.map((owner) => owner.dir).sort(),
    );
  });

  it.each(entries)('$table is written only inside its owner', (entry) => {
    expect(writersOutsideOwner(repoRoot, sources, entry, owners)).toEqual([]);
  });
});

function plantedTree(): string {
  const base = mkdtempSync(join(tmpdir(), 'uw-owners-'));
  mkdirSync(join(base, 'apps/uw-app/people'), { recursive: true });
  mkdirSync(join(base, 'apps/uw-app/acl'), { recursive: true });
  writeFileSync(join(base, 'apps/uw-app/people/directory.ts'), 'db.insert(people).values(row);');
  writeFileSync(join(base, 'apps/uw-app/acl/stray.ts'), 'await db.insert(people).values(row);');
  writeFileSync(join(base, 'apps/uw-app/acl/raw.ts'), 'sql`UPDATE people SET status = 1`;');
  return base;
}

function plantedOutsideApps(): string {
  const base = mkdtempSync(join(tmpdir(), 'uw-owners-'));
  mkdirSync(join(base, 'apps/uw-app/people'), { recursive: true });
  mkdirSync(join(base, 'packages/harness'), { recursive: true });
  mkdirSync(join(base, 'packages/db'), { recursive: true });
  mkdirSync(join(base, 'sim/adapters'), { recursive: true });
  writeFileSync(join(base, 'apps/uw-app/people/directory.ts'), 'db.insert(people).values(row);');
  writeFileSync(join(base, 'apps/uw-app/namespaced.ts'), 'tx.insert(schema.people);');
  writeFileSync(join(base, 'packages/harness/store.ts'), 'await db.update(people).set(row);');
  writeFileSync(join(base, 'packages/db/schema.ts'), 'db.insert(people).values(row);');
  writeFileSync(join(base, 'sim/adapters/store.ts'), 'await tx.delete(schema.people);');
  return base;
}

describe('AGENTS.md rule 3: the check scans packages and the sim', () => {
  const people_: Entry = { exportName: 'people', table: 'people' };

  it('scans every package except packages/db, and the sim when present', () => {
    const base = plantedOutsideApps();
    expect(scanRoots(base)).toEqual(['apps/uw-app', 'packages/harness', 'sim']);
  });

  it('catches a namespaced write in an app, a package and the sim', () => {
    const base = plantedOutsideApps();
    const found = writersOutsideOwner(base, sourcesUnder(base, scanRoots(base)), people_, [
      { dir: 'apps/uw-app/people/', tables: ['people'] },
    ]);
    expect(found.sort()).toEqual([
      'apps/uw-app/namespaced.ts',
      'packages/harness/store.ts',
      'sim/adapters/store.ts',
    ]);
  });
});

describe('AGENTS.md rule 3: the check itself fails on a violation', () => {
  const people_: Entry = { exportName: 'people', table: 'people' };

  it('fails when a table is claimed by two modules', () => {
    const doubled = [...owners, { dir: 'apps/uw-app/acl/', tables: ['people'] }];
    expect(claimProblems(doubled, ['people'])).toContain('people is claimed twice');
  });

  it('fails when a table is claimed by no module', () => {
    expect(claimProblems([], ['people'])).toContain('people is claimed by no module');
  });

  it('fails when a module outside the owner writes the table', () => {
    const base = plantedTree();
    const found = writersOutsideOwner(base, sourcesUnder(base, ['apps/uw-app']), people_, [
      { dir: 'apps/uw-app/people/', tables: ['people'] },
    ]);
    expect(found.sort()).toEqual(['apps/uw-app/acl/raw.ts', 'apps/uw-app/acl/stray.ts']);
  });
});
